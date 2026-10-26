# services/sandbox-egress/outbound-proxies.awk
#
# Reads OUTBOUND_PROXY_URLS on standard input and prints one squid
# `cache_peer` line per proxy, in the order written, for the outbound hop
# (squid.conf.template). Entries are separated by commas and whitespace;
# none at all prints nothing.
#
# The backend reads the same value with `@tale/shared/net/outbound-proxies`,
# and this program keeps its grammar and its refusals word for word (a
# platform guard runs both over the same entries):
# http://[user:password@]host[:port], the user name and the password
# percent-encoded wherever they hold a character other than a letter, a
# digit or one of -._~!$&'()*+;=:, each escape a printable ASCII character,
# at most 128 bytes together once decoded (squid's limit for a parent's
# login, past which it crashes), a host name or an IPv4 address, and nothing
# after the host but one `/`. squid decodes the escapes of `login=` itself,
# so the credentials pass through as written.
#
# The first malformed entry stops the program: it prints why, naming the
# entry by position and never by its text (which may hold a password), and
# exits 1 without printing a peer. Run it under LC_ALL=C, so every character
# class below is ASCII.

function refuse(reason) {
  failure = "OUTBOUND_PROXY_URLS entry " position " " reason \
    " (expected http://[user:password@]host[:port])"
  exit 1
}

function hex_value(digits,    hex) {
  hex = "0123456789abcdef"
  return (index(hex, tolower(substr(digits, 1, 1))) - 1) * 16 \
    + index(hex, tolower(substr(digits, 2, 1))) - 1
}

# Whether every escape in a value already known to hold well-formed ones
# encodes a printable ASCII character (%20 to %7E).
function printable_escapes(value,    i, code) {
  for (i = 1; i <= length(value); i++) {
    if (substr(value, i, 1) != "%") continue
    code = hex_value(substr(value, i + 1, 2))
    if (code < 32 || code > 126) return 0
    i += 2
  }
  return 1
}

# A value with its escapes decoded; each is printable ASCII by then.
function decode(value,    out, i, c) {
  out = ""
  for (i = 1; i <= length(value); i++) {
    c = substr(value, i, 1)
    if (c == "%") {
      out = out sprintf("%c", hex_value(substr(value, i + 1, 2)))
      i += 2
    } else {
      out = out c
    }
  }
  return out
}

function valid_host(host,    labels, count, i, last) {
  if (length(host) == 0 || length(host) > 253) return 0
  count = split(host, labels, ".")
  for (i = 1; i <= count; i++) {
    if (length(labels[i]) > 63) return 0
    if (labels[i] !~ /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/) return 0
    # A URL parser decodes such a label as punycode and refuses an invalid
    # one, which this reader cannot judge.
    if (substr(labels[i], 1, 4) == "xn--") return 0
  }
  last = labels[count]
  # A last label a URL parser reads as a number makes the whole host an
  # IPv4 address in its eyes: only a canonical dotted quad reads the same.
  if (last !~ /^([0-9]+|0x[0-9a-f]*)$/) return 1
  if (count != 4) return 0
  for (i = 1; i <= 4; i++) {
    if (labels[i] !~ /^(0|[1-9][0-9]*)$/ || labels[i] + 0 > 255) return 0
  }
  return 1
}

function read_entry(entry,    rest, cut, mark, authority, tail, at, s, i,
    userinfo, escapes, escaped, colon, user, host_port, count, hp, host,
    port, line) {
  position++
  if (tolower(substr(entry, 1, 7)) != "http://")
    refuse("is not an http:// proxy URL")
  rest = substr(entry, 8)
  # The authority ends at the first `/`, `?` or `#`.
  cut = 0
  for (i = 1; i <= 3; i++) {
    mark = index(rest, substr("/?#", i, 1))
    if (mark > 0 && (cut == 0 || mark < cut)) cut = mark
  }
  if (cut > 0) {
    authority = substr(rest, 1, cut - 1)
    tail = substr(rest, cut)
  } else {
    authority = rest
    tail = ""
  }
  if (tail != "" && tail != "/")
    refuse("has a path, query or fragment after the host")

  # The credentials end at the last `@`.
  at = 0
  s = authority
  while ((i = index(s, "@")) > 0) {
    at += i
    s = substr(s, i + 1)
  }
  userinfo = ""
  host_port = authority
  if (at > 0) {
    userinfo = substr(authority, 1, at - 1)
    host_port = substr(authority, at + 1)
    escapes = userinfo
    escaped = gsub(/%[0-9A-Fa-f][0-9A-Fa-f]/, "", escapes)
    if (userinfo !~ /^[A-Za-z0-9._~!$&'()*+;=:%-]*$/ || index(escapes, "%") > 0)
      refuse("has a character in its user name or password that must be percent-encoded")
    if (!printable_escapes(userinfo))
      refuse("encodes a character other than printable ASCII in its user name or password")
    colon = index(userinfo, ":")
    if (colon <= 1 || colon == length(userinfo))
      refuse("has credentials without both a user name and a password")
    if (length(userinfo) - 2 * escaped > 128)
      refuse("has a user name and password longer than 128 bytes together")
    # squid reads these as login modes rather than a user name: `*` passes
    # on the client's own user name, NEGOTIATE asks for Kerberos.
    user = decode(substr(userinfo, 1, colon - 1))
    if (substr(user, 1, 1) == "*" || substr(user, 1, 9) == "NEGOTIATE")
      refuse("has a user name squid reads as an instruction (it begins with * or NEGOTIATE)")
  }

  if (substr(host_port, 1, 1) == "[")
    refuse("names an IPv6 address; name the proxy by host name or IPv4 address")
  count = split(host_port, hp, ":")
  if (count > 2) refuse("names no valid host and port")
  host = tolower(hp[1])
  if (!valid_host(host)) refuse("names no valid host")
  port = 80
  if (count == 2) {
    if (hp[2] !~ /^[1-9][0-9]*$/ || length(hp[2]) > 5 || hp[2] + 0 > 65535)
      refuse("has a port outside 1-65535")
    port = hp[2] + 0
  }

  # Concatenated, never a printf format: the credentials may hold `%`.
  line = "cache_peer " host " parent " port " 0 no-query no-digest round-robin" \
    " connect-timeout=10 connect-fail-limit=2 name=outbound-" position
  if (at > 0) line = line " login=" userinfo
  peers[position] = line
}

{
  count = split($0, entries, /[ \t\r\f\v,]+/)
  for (n = 1; n <= count; n++)
    if (entries[n] != "") read_entry(entries[n])
}

END {
  if (failure != "") {
    print failure
    exit 1
  }
  for (n = 1; n <= position; n++) print peers[n]
}
