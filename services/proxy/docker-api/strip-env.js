// The Docker API proxy's filter on container inspect answers: Config.Env
// goes. Every container's environment, secrets included, is in that answer,
// and Traefik reads labels, networks and state, never Env. An answer this
// filter cannot parse is not passed on.
//
// Each request runs in its own njs VM, so the buffered chunks are its own.
let chunks = [];

function headers(r) {
  delete r.headersOut['Content-Length'];
}

function body(r, data, flags) {
  chunks.push(data);
  if (!flags.last) return;
  const all = Buffer.concat(chunks);
  chunks = [];
  let out = '';
  try {
    const answer = JSON.parse(all.toString());
    if (answer && answer.Config) delete answer.Config.Env;
    out = JSON.stringify(answer);
  } catch (e) {
    r.error(
      'docker-api: dropped an inspect answer it could not parse: ' + e.message,
    );
  }
  r.sendBuffer(out, { last: true });
}

export default { headers: headers, body: body };
