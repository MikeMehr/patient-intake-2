const fetch = require('node-fetch');

async function testLogin() {
  try {
    const response = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'MehraeinAdmin',
        password: 'Pizza1212$'
      })
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    console.log('Cookies:', response.headers.get('set-cookie'));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testLogin();
