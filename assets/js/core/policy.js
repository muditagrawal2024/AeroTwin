// Minimal IAM-style bucket policy evaluator.
// Supports Effect, Principal ("*" or {"AWS": "*"}), Action / NotAction and
// Resource with "*" and "?" wildcards. An explicit Deny always wins, exactly
// like the real evaluation logic.

const toArray = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function wildcardMatch(pattern, value) {
  const re = new RegExp('^' + String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.') + '$', 'i');
  return re.test(value);
}

function principalMatches(principal, requester) {
  if (principal === '*') return true;
  if (principal && typeof principal === 'object') {
    return toArray(principal.AWS).some(p => p === '*' || p === requester);
  }
  return false;
}

/** Validate a policy document. Returns { ok, errors[], doc }. */
export function validatePolicy(text, bucket) {
  const errors = [];
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { ok: false, errors: ['Policy is not valid JSON: ' + e.message] }; }
  if (!doc || typeof doc !== 'object') errors.push('Policy must be a JSON object.');
  if (doc.Version && doc.Version !== '2012-10-17' && doc.Version !== '2008-10-17') errors.push('Version must be "2012-10-17".');
  const stmts = toArray(doc.Statement);
  if (!stmts.length) errors.push('Policy needs at least one Statement.');
  stmts.forEach((s, i) => {
    const n = `Statement ${i + 1}`;
    if (!['Allow', 'Deny'].includes(s.Effect)) errors.push(`${n}: Effect must be "Allow" or "Deny".`);
    if (s.Principal === undefined) errors.push(`${n}: Principal is required in a bucket policy.`);
    if (s.Action === undefined && s.NotAction === undefined) errors.push(`${n}: Action is required.`);
    toArray(s.Action).forEach(a => { if (!/^s3:[\w*?]+$|^\*$/.test(a)) errors.push(`${n}: "${a}" is not an S3 action.`); });
    const res = toArray(s.Resource);
    if (!res.length) errors.push(`${n}: Resource is required.`);
    res.forEach(r => {
      if (!r.startsWith(`arn:aws:s3:::${bucket}`)) errors.push(`${n}: Resource "${r}" must belong to arn:aws:s3:::${bucket}.`);
    });
  });
  return { ok: errors.length === 0, errors, doc };
}

/** Evaluate a request. Returns 'Allow' | 'Deny' | 'ImplicitDeny'. */
export function evaluatePolicy(doc, { action, resource, requester = '*' }) {
  if (!doc) return 'ImplicitDeny';
  let allowed = false;
  for (const s of toArray(doc.Statement)) {
    if (!principalMatches(s.Principal, requester)) continue;
    const actionHit = s.NotAction !== undefined
      ? !toArray(s.NotAction).some(a => wildcardMatch(a, action))
      : toArray(s.Action).some(a => wildcardMatch(a, action));
    if (!actionHit) continue;
    if (!toArray(s.Resource).some(r => wildcardMatch(r, resource))) continue;
    if (s.Effect === 'Deny') return 'Deny';
    if (s.Effect === 'Allow') allowed = true;
  }
  return allowed ? 'Allow' : 'ImplicitDeny';
}

export function publicReadPolicy(bucket, prefix = '') {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Sid: 'PublicReadGetObject',
      Effect: 'Allow',
      Principal: '*',
      Action: 's3:GetObject',
      Resource: `arn:aws:s3:::${bucket}/${prefix}*`
    }]
  }, null, 2);
}
