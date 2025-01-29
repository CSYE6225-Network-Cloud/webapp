const { bootstrapDatabase } = require('./db');

(async () => {
    try {
        // Call the bootstrap method to set up the database and tables
        await bootstrapDatabase();
        console.log('Database bootstrap completed successfully.');
    } catch (error) {
        console.error('Error bootstrapping database:', error);
        // Exit if bootstrap fails
        process.exit(1);
    }
})();
