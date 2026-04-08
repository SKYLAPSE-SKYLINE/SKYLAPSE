const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const DATABASE_URL = 'postgresql://gustavohenrique@192.168.65.254:5432/skylapse';
const JWT_SECRET = 'RK7hv4GWJ9_fs6LSg6LEBSH_k29c1qFy2DfPjbawbRWsDpJ6kNK3ARHf2xuQgft3_admin';

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const result = await client.query('SELECT id, email FROM admin_accounts LIMIT 5');
  await client.end();

  if (result.rows.length === 0) {
    console.log('No admin accounts found.');
    return;
  }

  console.log('Admin accounts found:');
  result.rows.forEach(row => console.log(`  id=${row.id}, email=${row.email}`));

  const firstId = result.rows[0].id;
  const token = jwt.sign({ adminAccountId: firstId }, JWT_SECRET, { expiresIn: '24h' });

  console.log(`\nAdmin Account ID: ${firstId}`);
  console.log(`ADMIN_JWT: ${token}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
