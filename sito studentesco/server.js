const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configurazione
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'new-wave-secret-key-2025';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/comitato-newwave';

// Connessione al database MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connesso a MongoDB'))
  .catch(err => console.error('Errore connessione MongoDB:', err));

// Schemi del database
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' }
});

const newsSchema = new mongoose.Schema({
  title: { type: String, required: true },
  date: { type: Date, required: true },
  content: { type: String, required: true },
  mediaType: { type: String, default: 'none' },
  mediaUrl: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const questionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  date: { type: Date, default: Date.now },
  expires: { type: Date, required: true },
  answered: { type: Boolean, default: false }
});

const contentSchema = new mongoose.Schema({
  type: { type: String, required: true, unique: true },
  heroTitle: { type: String },
  heroText: { type: String },
  customLink: {
    url: { type: String, default: '#' },
    text: { type: String, default: 'Link Aggiuntivo' }
  }
});

// Modelli
const User = mongoose.model('User', userSchema);
const News = mongoose.model('News', newsSchema);
const Question = mongoose.model('Question', questionSchema);
const Content = mongoose.model('Content', contentSchema);

// Middleware di autenticazione
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token di accesso richiesto' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token non valido' });
    }
    req.user = user;
    next();
  });
};

// Inizializza dati di default
async function initializeDefaultData() {
  try {
    // Crea admin se non esiste
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('NewWave2025!', 10);
      await User.create({
        username: 'admin',
        password: hashedPassword,
        role: 'admin'
      });
      console.log('Utente admin creato');
    }

    // Contenuto di default
    const defaultContent = await Content.findOne({ type: 'home' });
    if (!defaultContent) {
      await Content.create({
        type: 'home',
        heroTitle: 'COMITATO STUDENTESCO NEW WAVE',
        heroText: 'L\'onda del cambiamento nella tua scuola. Innovazione, rappresentanza e partecipazione attiva per tutti gli studenti.',
        customLink: {
          url: '#',
          text: 'Link Aggiuntivo'
        }
      });
      console.log('Contenuto di default creato');
    }
  } catch (error) {
    console.error('Errore inizializzazione dati:', error);
  }
}

// API Routes

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Errore login:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Ottieni tutte le news
app.get('/api/news', async (req, res) => {
  try {
    const news = await News.find().sort({ date: -1 });
    res.json(news);
  } catch (error) {
    console.error('Errore recupero news:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Aggiungi news (solo admin)
app.post('/api/news', authenticateToken, async (req, res) => {
  try {
    const { title, date, content, mediaType, mediaUrl } = req.body;

    const newsItem = await News.create({
      title,
      date: new Date(date),
      content,
      mediaType,
      mediaUrl
    });

    // Invia aggiornamento a tutti i client connessi
    io.emit('news_update', await News.find().sort({ date: -1 }));

    res.status(201).json(newsItem);
  } catch (error) {
    console.error('Errore creazione news:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Elimina news (solo admin)
app.delete('/api/news/:id', authenticateToken, async (req, res) => {
  try {
    await News.findByIdAndDelete(req.params.id);
    
    // Invia aggiornamento a tutti i client connessi
    io.emit('news_update', await News.find().sort({ date: -1 }));
    
    res.json({ message: 'News eliminata con successo' });
  } catch (error) {
    console.error('Errore eliminazione news:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Ottieni domande (solo admin)
app.get('/api/questions', authenticateToken, async (req, res) => {
  try {
    const questions = await Question.find().sort({ date: -1 });
    res.json(questions);
  } catch (error) {
    console.error('Errore recupero domande:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Aggiungi domanda
app.post('/api/questions', async (req, res) => {
  try {
    const { text } = req.body;
    
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);

    const question = await Question.create({
      text,
      expires
    });

    // Notifica gli admin che c'è una nuova domanda
    io.emit('new_question', question);

    res.status(201).json(question);
  } catch (error) {
    console.error('Errore creazione domanda:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Elimina domanda (solo admin)
app.delete('/api/questions/:id', authenticateToken, async (req, res) => {
  try {
    await Question.findByIdAndDelete(req.params.id);
    res.json({ message: 'Domanda eliminata con successo' });
  } catch (error) {
    console.error('Errore eliminazione domanda:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Ottieni contenuto
app.get('/api/content', async (req, res) => {
  try {
    const content = await Content.findOne({ type: 'home' });
    res.json(content);
  } catch (error) {
    console.error('Errore recupero contenuto:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Aggiorna contenuto (solo admin)
app.put('/api/content', authenticateToken, async (req, res) => {
  try {
    const { heroTitle, heroText, customLink } = req.body;

    const updatedContent = await Content.findOneAndUpdate(
      { type: 'home' },
      { 
        heroTitle, 
        heroText, 
        customLink 
      },
      { new: true, upsert: true }
    );

    // Invia aggiornamento a tutti i client connessi
    io.emit('content_update', updatedContent);

    res.json(updatedContent);
  } catch (error) {
    console.error('Errore aggiornamento contenuto:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Gestione WebSocket
io.on('connection', (socket) => {
  console.log('Nuovo client connesso:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnesso:', socket.id);
  });

  // Unisciti alla room admin se autenticato
  socket.on('admin_join', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role === 'admin') {
        socket.join('admin');
        console.log('Admin connesso:', decoded.username);
      }
    } catch (error) {
      console.log('Token non valido per admin');
    }
  });
});

// Pulizia domande scadute
setInterval(async () => {
  try {
    const result = await Question.deleteMany({ 
      expires: { $lt: new Date() } 
    });
    
    if (result.deletedCount > 0) {
      console.log(`Eliminate ${result.deletedCount} domande scadute`);
    }
  } catch (error) {
    console.error('Errore pulizia domande scadute:', error);
  }
}, 24 * 60 * 60 * 1000); // Ogni 24 ore

// Avvia il server
server.listen(PORT, async () => {
  console.log(`Server in esecuzione sulla porta ${PORT}`);
  await initializeDefaultData();
});
