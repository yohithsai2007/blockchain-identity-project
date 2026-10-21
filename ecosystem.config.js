module.exports = {
  apps: [
    {
      name: 'blockchain-python-service',
      script: './python-service/app.py',
      interpreter: './venv/bin/python',
      cwd: './',
      env: {
        HOST: '0.0.0.0',
        PORT: 5001
      },
      watch: false,
      restart_delay: 3000,
      max_restarts: 10
    },
    {
      name: 'identity-web-backend',
      script: './backend/server.js',
      cwd: './',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        PYTHON_SERVICE_URL: 'http://127.0.0.1:5001'
      },
      watch: false,
      restart_delay: 3000,
      max_restarts: 10
    }
  ]
};
