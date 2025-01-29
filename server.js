//imports
const express = require('express');
const { sequelize } = require('./db');
const healthzRoutes = require('./routes/healthz');
require('dotenv').config();

const app = express();
const PORT =  process.env.PORT;

app.use(express.json());

// Use the healthz route
app.use('/', healthzRoutes);

// Middleware to handle unimplemented routes
app.use((req, res) => {
    res.status(404).send();
});

// Sync database and start the server
sequelize.sync().then(() => {
    console.log('Database synchronized.');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
