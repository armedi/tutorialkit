const express = require('express');
const app = express();
const port = 3000;

app.get('/', (_, res) => {
  res.send('Hello World');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${port}`);
});
