import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5570;

app.use(express.static(join(__dirname, 'src')));

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'src', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`YourSound running on port ${PORT}`);
});
