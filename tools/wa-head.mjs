import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const f = path.join(process.env.USERPROFILE, 'Desktop', 'New folder (15)', 'msgstore.db.crypt15');
const b = fs.readFileSync(f);
const md5a = crypto.createHash('md5').update(b.subarray(0, b.length - 16)).digest('hex');
const pb = 2 + b[0];
const md5b = crypto.createHash('md5').update(b.subarray(pb, b.length - 16)).digest('hex');
fs.writeFileSync('C:\\raddad\\data\\wa-head.log', `last16=${b.subarray(b.length - 16).toString('hex')}\nmd5_all=${md5a}\nmd5_body=${md5b}\n`);
