import { h } from '../../core/util.js';

const MAP = [
  ['Buckets and objects', 'Create and delete buckets with the real naming rules; upload, download, copy and delete objects; folders are key prefixes grouped on "/"; MD5 ETags; multipart uploads above 5 MB.', '#/s3'],
  ['Versioning', 'Every overwrite keeps the old version, deletes add a delete marker, and any old version can be made current again.', '#/s3/aerotwin-missions?tab=objects'],
  ['Storage classes', 'Standard, Standard-IA, Glacier Instant, Glacier Flexible and Deep Archive, each with its own price and retrieval rules. Archived objects need a restore before they can be read.', '#/s3/aerotwin-flight-logs?prefix=logs/'],
  ['Lifecycle management', 'Rules move ageing objects to cheaper classes and expire them. A simulated clock jumps 90 days ahead in one click.', '#/s3/aerotwin-flight-logs?tab=management'],
  ['Security', 'Block Public Access, JSON bucket policies with an evaluator, SSE-S3 encryption (real AES-256-GCM) and presigned URLs signed with AWS Signature Version 4.', '#/s3/aerotwin-public-gallery?tab=permissions'],
  ['Event notifications', 'ObjectCreated events trigger the flight-indexer function, which summarises each new flight log into analytics/flight-index.json.', '#/s3/aerotwin-flight-logs?tab=properties'],
  ['Pricing and billing', 'Storage is metered in GB-months per class, requests in PUT and GET tiers, plus retrieval and transfer out, with a budget alert and a forecast.', '#/billing'],
  ['Access paths', 'The console, an AWS CLI emulator, public object URLs and presigned URLs all call the same engine, and every call appears in the activity log.', '#/cli']
];

const DIAGRAM = `<svg class="flow-diagram" viewBox="0 0 860 330" role="img" aria-label="AeroTwin architecture: the drone simulator and the console call the simulated S3 API, which stores data in IndexedDB, runs lifecycle rules and notifications and feeds billing.">
<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#6d86a0"/></marker></defs>
<g font-family="Archivo, sans-serif" font-size="13" fill="#e7eef5">
  <rect x="10" y="20" width="200" height="120" rx="10" fill="#1d3650" stroke="#ff7a1a"/>
  <text x="26" y="46" font-weight="700" font-size="15">Drone simulator</text>
  <text x="26" y="70" fill="#95abc1">keyboard · gamepad · Blockly</text>
  <text x="26" y="92" fill="#95abc1">telemetry recorder</text>
  <text x="26" y="114" fill="#95abc1">gimbal camera</text>
  <rect x="10" y="180" width="200" height="120" rx="10" fill="#1d3650" stroke="#2a4661"/>
  <text x="26" y="206" font-weight="700" font-size="15">Clients</text>
  <text x="26" y="230" fill="#95abc1">S3 console</text>
  <text x="26" y="252" fill="#95abc1">AWS CLI emulator</text>
  <text x="26" y="274" fill="#95abc1">public and presigned URLs</text>
  <rect x="300" y="60" width="250" height="200" rx="12" fill="#172c42" stroke="#3fc6b4" stroke-width="1.5"/>
  <text x="318" y="88" font-weight="700" font-size="15">Simulated S3 API</text>
  <text x="318" y="114" fill="#95abc1">PutObject · GetObject · ListObjectsV2</text>
  <text x="318" y="136" fill="#95abc1">versioning · policies · SSE</text>
  <text x="318" y="158" fill="#95abc1">SigV4 presigning</text>
  <rect x="318" y="180" width="214" height="60" rx="8" fill="#13253a" stroke="#2a4661"/>
  <text x="334" y="206" font-weight="600">IndexedDB</text>
  <text x="334" y="226" fill="#95abc1">buckets · objects · blobs · log</text>
  <rect x="640" y="10" width="210" height="80" rx="10" fill="#1d3650" stroke="#2a4661"/>
  <text x="656" y="38" font-weight="700">Lifecycle engine</text>
  <text x="656" y="60" fill="#95abc1">runs when the clock moves</text>
  <rect x="640" y="125" width="210" height="80" rx="10" fill="#1d3650" stroke="#2a4661"/>
  <text x="656" y="153" font-weight="700">Event notifications</text>
  <text x="656" y="175" fill="#95abc1">flight-indexer function</text>
  <rect x="640" y="240" width="210" height="80" rx="10" fill="#1d3650" stroke="#2a4661"/>
  <text x="656" y="268" font-weight="700">Billing meter</text>
  <text x="656" y="290" fill="#95abc1">GB-months · requests · budget</text>
</g>
<g stroke="#6d86a0" stroke-width="1.6" fill="none" marker-end="url(#ah)">
  <path d="M210 80 C255 80 255 120 298 120"/>
  <path d="M210 240 C255 240 255 200 298 200"/>
  <path d="M550 110 C600 110 600 50 638 50"/>
  <path d="M550 160 L638 165"/>
  <path d="M550 220 C600 220 600 280 638 280"/>
</g>
<g font-family="Archivo, sans-serif" font-size="11" fill="#6d86a0">
  <text x="218" y="70">PutObject</text>
  <text x="218" y="266">API calls</text>
</g>
</svg>`;

export async function render(root) {
  root.replaceChildren(
    h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, 'How S3 works here'),
      h('p', {}, 'Amazon Simple Storage Service (S3) is object storage: you put files (objects) under keys inside buckets and read them back over HTTP, with durability, access control, versioning, tiered pricing and lifecycle automation built in. AeroTwin re-implements that behaviour in the browser so every concept can be tried and inspected.'))),
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Request workflow')),
      h('div', { class: 'pad prose' }, h('ul', {},
        h('li', {}, h('b', {}, 'A client sends a request. '), 'The console, the CLI emulator or the drone simulator calls an S3 operation such as PutObject, with a bucket name and an object key.'),
        h('li', {}, h('b', {}, 'S3 checks access. '), 'Block Public Access, the bucket policy, or a presigned URL signature decides whether the request is allowed. Denied requests return AccessDenied, just like real S3.'),
        h('li', {}, h('b', {}, 'S3 stores the object. '), 'The body is encrypted (SSE-S3), given an MD5 ETag and a version ID, and placed in the requested storage class.'),
        h('li', {}, h('b', {}, 'Side effects happen. '), 'Event notifications call functions, the request is logged and billed, and lifecycle rules later move or expire the object as it ages.')))),
    h('section', { class: 'panel' }, h('div', { class: 'pad' }, h('div', { html: DIAGRAM }))),
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'S3 features and where to find them')),
      h('div', { class: 'table-wrap' }, h('table', { class: 't map-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'S3 capability'), h('th', {}, 'What AeroTwin implements'), h('th', {}))),
        h('tbody', {}, MAP.map(([a, b, link]) => h('tr', {}, h('td', {}, a), h('td', {}, b), h('td', {}, h('a', { class: 'btn small', href: link }, 'Open')))))))),
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Enhancements beyond plain S3')),
      h('div', { class: 'pad prose' },
        h('ul', {},
          h('li', {}, h('b', {}, 'A live data producer. '), 'A full drone flight simulator writes real objects into the buckets: a JSON flight log after every landing or crash, PNG photos and WebM recordings from the gimbal camera, and Blockly mission files that are versioned like code.'),
          h('li', {}, h('b', {}, 'Replay from storage. '), 'Any flight log in S3 can be replayed in 3D as a ghost drone. Logs that lifecycle moved to Glacier must be restored first, which shows the real cost of archiving.'),
          h('li', {}, h('b', {}, 'Time travel. '), 'A simulated clock shows lifecycle transitions, Glacier restore delays and presigned URL expiry without waiting.'),
          h('li', {}, h('b', {}, 'Cost insight. '), 'A live month-to-date meter, a budget alert, and a what-if calculator that projects a year of drone-fleet storage with and without lifecycle tiering.'),
          h('li', {}, h('b', {}, 'Three ways to fly. '), 'Keyboard (Mode 2 layout), any USB or Bluetooth gamepad, and block-based missions with loops, functions and sensors.')))),
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Deployment')),
      h('div', { class: 'pad prose' },
        h('p', {}, 'This website itself runs on real AWS: the static files are stored in an Amazon S3 bucket with static website hosting, and served over HTTPS through Amazon CloudFront. The source code is on GitHub.'))),
    h('section', { class: 'panel' }, h('header', {}, h('h3', {}, 'Credits')),
      h('div', { class: 'pad prose' },
        h('p', {}, 'AeroTwin was built by Mudit (VIT Chennai) for BCSE355L Cloud Architecture Design, Digital Assignment 3.'),
        h('p', {}, 'The block-programming command set and arc maths are adapted from ', h('a', { href: 'https://github.com/vroby65/DroneCommander', target: '_blank', rel: 'noopener' }, 'Drone Commander'), ' by vroby65, and the gamepad handling and motor sound from ', h('a', { href: 'https://github.com/MSubham06/Drone_Simulator', target: '_blank', rel: 'noopener' }, 'Drone Simulator'), ' by Subham, both MIT licensed. Rendering uses three.js and block editing uses Google Blockly.')))
  );
}
