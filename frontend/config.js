// Smart Auto-detection:
// If running on localhost / 127.0.0.1, use the local Node backend.
// If running on Vercel or online, use the live Render backend URL.
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  window.BACKEND_API_URL = '';
} else {
  window.BACKEND_API_URL = 'https://blockchain-identity-project.onrender.com';
}
