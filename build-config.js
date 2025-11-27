const fs = require('fs');

// On récupère les variables définies dans Vercel
const configContent = `// Fichier généré automatiquement par Vercel
const firebaseConfig = {
  apiKey: "${process.env.FIREBASE_API_KEY}",
  authDomain: "${process.env.FIREBASE_AUTH_DOMAIN}",
  projectId: "${process.env.FIREBASE_PROJECT_ID}",
  storageBucket: "${process.env.FIREBASE_STORAGE_BUCKET}",
  messagingSenderId: "${process.env.FIREBASE_MESSAGING_SENDER_ID}",
  appId: "${process.env.FIREBASE_APP_ID}"
};`;

// On écrit le fichier config.js pour que le navigateur puisse le lire
fs.writeFileSync('./config.js', configContent);
console.log('✅ config.js a été généré avec succès !');