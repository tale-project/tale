// Package bodyfaults answers a request whose body the client framed wrongly
// with the API's 400 error envelope. Traefik cannot read such a body and
// answers as for a failing service: a malformed chunked body gets its 500, an
// HTTP/2 body that ends before its declared Content-Length its 502, which the
// errors middleware then shows as the platform being unavailable.
//
// Traefik interprets this file (Yaegi) from the proxy image, so it uses the
// standard library alone and nothing is downloaded.
package bodyfaults

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// Answer is what the answer to one fault says, in the API's error envelope.
type Answer struct {
	Code  string
	Error string
}

// Config is the middleware's configuration, rendered by render/config.js.
type Config struct {
	// Headers are set on each answer, beside its Content-Type and X-Request-Id.
	Headers map[string]string
	// ChunkMalformed answers an HTTP/1.1 chunked body whose framing is malformed.
	ChunkMalformed Answer
	// LengthMismatch answers an HTTP/2 body that ends before its declared
	// Content-Length.
	LengthMismatch Answer
}

// CreateConfig returns the empty configuration: a fault without an answer
// keeps the one Traefik gives.
func CreateConfig() *Config {
	return &Config{Headers: map[string]string{}}
}

// The errors Go's HTTP/1.1 server reads a malformed chunked body with
// (net/http/internal/chunked.go, and the trailer after the last chunk).
var chunkErrors = []string{
	"malformed chunked encoding",
	"chunked line ends with bare LF",
	"invalid CR in chunked line",
	"empty hex number for chunk length",
	"invalid byte in chunk length",
	"http chunk length too large",
	"chunked encoding contains too much non-data",
	"header line too long",
	"malformed MIME header",
}

// The error Go's HTTP/2 server ends a body with when its stream ends before
// the declared Content-Length.
const shortBody = "request declared a Content-Length of "

type bodyFaults struct {
	next    http.Handler
	headers map[string]string
	// The answers' envelopes up to their request id, or "" when unanswered.
	chunkMalformed string
	lengthMismatch string
}

// New creates the middleware.
func New(_ context.Context, next http.Handler, config *Config, _ string) (http.Handler, error) {
	headers := make(map[string]string, len(config.Headers))
	for name, value := range config.Headers {
		headers[name] = value
	}
	return &bodyFaults{
		next:           next,
		headers:        headers,
		chunkMalformed: envelope(config.ChunkMalformed),
		lengthMismatch: envelope(config.LengthMismatch),
	}, nil
}

func envelope(a Answer) string {
	if a.Code == "" {
		return ""
	}
	return `{"error":` + quote(a.Error) + `,"code":` + quote(a.Code) + `,"requestId":"`
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func (m *bodyFaults) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	// Only a chunked body, or an HTTP/2 body with a declared length, can fail
	// so: every other request passes untouched.
	if len(req.TransferEncoding) == 0 && (req.ProtoMajor < 2 || req.ContentLength <= 0) {
		m.next.ServeHTTP(rw, req)
		return
	}
	b := &body{rc: req.Body, m: m}
	req.Body = b
	m.next.ServeHTTP(&writer{rw: rw, body: b, m: m, header: rw.Header().Clone()}, req)
}

// classify returns the envelope that answers a body read error, or "".
func (m *bodyFaults) classify(err error) string {
	msg := err.Error()
	if strings.Contains(msg, shortBody) {
		return m.lengthMismatch
	}
	for _, chunkError := range chunkErrors {
		if strings.Contains(msg, chunkError) {
			return m.chunkMalformed
		}
	}
	return ""
}

// body notes why the client's body failed, for the writer to answer.
type body struct {
	rc    io.ReadCloser
	m     *bodyFaults
	mu    sync.Mutex
	fault string
}

func (b *body) Read(p []byte) (int, error) {
	n, err := b.rc.Read(p)
	if err != nil && err != io.EOF {
		if fault := b.m.classify(err); fault != "" {
			b.mu.Lock()
			if b.fault == "" {
				b.fault = fault
			}
			b.mu.Unlock()
		}
	}
	return n, err
}

func (b *body) Close() error {
	return b.rc.Close()
}

func (b *body) noted() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.fault
}

// writer replaces the status Traefik gives a body it could not read (500 or
// more) with the fault's answer. The writer Traefik hands a plugin flushes,
// but compiled code cannot reach a Flush method of this interpreted one, so
// it flushes a streamed answer (no Content-Length, or an event stream) after
// each write, as Traefik's proxy would.
type writer struct {
	rw     http.ResponseWriter
	body   *body
	m      *bodyFaults
	header http.Header
	// wrote: the final status passed; answered: this writer answered instead.
	wrote    bool
	answered bool
	stream   bool
}

func (w *writer) Header() http.Header {
	return w.rw.Header()
}

func (w *writer) WriteHeader(status int) {
	if w.answered {
		return
	}
	if w.wrote || status < http.StatusOK && status != http.StatusSwitchingProtocols {
		w.rw.WriteHeader(status)
		return
	}
	w.wrote = true
	if status >= http.StatusInternalServerError {
		if fault := w.body.noted(); fault != "" {
			w.answer(fault)
			return
		}
	}
	h := w.rw.Header()
	w.stream = h.Get("Content-Length") == "" || strings.HasPrefix(h.Get("Content-Type"), "text/event-stream")
	w.rw.WriteHeader(status)
}

func (w *writer) Write(p []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	if w.answered {
		return len(p), nil
	}
	n, err := w.rw.Write(p)
	if w.stream {
		if f, ok := w.rw.(http.Flusher); ok {
			f.Flush()
		}
	}
	return n, err
}

// answer writes the fault's answer in place of what the services wrote: the
// headers the request arrived with, the configured ones and the envelope.
func (w *writer) answer(fault string) {
	w.answered = true
	id := requestID()
	payload := fault + id + `"}`
	h := w.rw.Header()
	for name := range h {
		delete(h, name)
	}
	for name, values := range w.header {
		h[name] = values
	}
	for name, value := range w.m.headers {
		h.Set(name, value)
	}
	h.Set("Content-Type", "application/json")
	h.Set("Content-Length", strconv.Itoa(len(payload)))
	h.Set("X-Request-Id", id)
	w.rw.WriteHeader(http.StatusBadRequest)
	_, _ = io.WriteString(w.rw, payload)
}

// requestID is a random UUID (version 4), the shape the platform's ids have.
func requestID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	s := hex.EncodeToString(b[:])
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}
