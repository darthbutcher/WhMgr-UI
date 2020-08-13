'use strict';

const path = require('path');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const app = express();
const mustacheExpress = require('mustache-express');
const helmet = require('helmet');
const i18n = require('i18n');

const config = require('./config.json');
const defaultData = require('./data/default.js');
const apiRoutes = require('./routes/api.js');
const discordRoutes = require('./routes/discord.js');
const uiRoutes = require('./routes/ui.js');
const utils = require('./services/utils.js');

// TODO: Group quests and invasion cities when listing
// TODO: Convert to typescript
// TODO: Import/export options
// TODO: Copy subscriptions to other discord server options
// TODO: Update insert if already exists update
// TODO: Fix issue with city all looping all pokemon/raids causing issues

run();

async function run() {
    // Basic security protections
    app.use(helmet());

    // View engine
    app.set('view engine', 'mustache');
    app.set('views', path.resolve(__dirname, 'views'));
    app.engine('mustache', mustacheExpress());

    // Static paths
    app.use(express.static(path.resolve(__dirname, '../static')));
    
    // Body parser middlewares
    app.use(express.json());
    app.use(express.urlencoded({ extended: false, limit: '50mb' }));

    // Initialize localzation handler
    i18n.configure({
        locales:['en', 'es', 'de'],
        directory: path.resolve(__dirname, '../static/locales')
    });
    app.use(i18n.init);
    
    // Register helper as a locals function wrroutered as mustache expects
    app.use((req, res, next) => {
        // Mustache helper
        res.locals.__ = function() {
            /* eslint-disable no-unused-vars */
            return function(text, render) {
            /* eslint-enable no-unused-vars */
                return i18n.__.routerly(req, arguments);
            };
        };
        next();
    });
    
    // Set locale
    i18n.setLocale(config.locale);

    // Session store in memory
    const store = new MemoryStore();

    // Sessions middleware
    app.use(session({
        secret: utils.generateString(),
        resave: true,
        store: store,
        saveUninitialized: true
    }));

    app.use('/api/discord', discordRoutes);

    // Discord error middleware
    /* eslint-disable no-unused-vars */
    app.use((err, req, res, next) => {
    /* eslint-enable no-unused-vars */
        switch (err.message) {
        case 'NoCodeProvided':
            return res.status(400).send({
                status: 'ERROR',
                error: err.message,
            });
        default:
            return res.status(500).send({
                status: 'ERROR',
                error: err.message,
            });
        }
    });

    // Login middleware
    app.use(async (req, res, next) => {
        res.header('Access-Control-Allow-Headers', '*');
        // Expose the store
        req.sessionStore = store;
        if (req.path === '/api/discord/login' || req.path === '/login') {
            return next();
        }
        const session = await getSession(store, req.sessionID);
        if (session === undefined || session === null) {
            res.redirect('/login');
            return;
        }

        //console.log('Session:', req.session);
        if (session.logged_in) {
            defaultData.logged_in = session.logged_in;
            defaultData.username = session.username || 'root';
            defaultData.user_id = session.user_id;
            let valid = false;
            const guilds = req.session.guilds;
            const roles = req.session.roles;
            defaultData.servers.forEach(server => {
                if (roles[server.id]) {
                    const userRoles = roles[server.id];
                    const requiredRoles = config.discord.guilds.filter(x => x.id === server.id);
                    if (requiredRoles.length > 0) {
                        if (guilds.includes(server.id) && utils.hasRole(userRoles, requiredRoles[0].roles)) {
                            valid = true;
                        }
                    }
                }
            });
            if (!session.valid || !valid) {
                console.error('Invalid user authentication, no valid roles for user', req.session.user_id);
                res.redirect('/login');
                return;
            }
            return next();
        }
        res.redirect('/login');
    });

    // API routes
    app.use('/api', apiRoutes);

    // CSRF token middleware
    app.use(cookieParser());
    app.use(csrf({ cookie: true }));
    app.use((req, res, next) => {
        const csrf = req.csrfToken();
        defaultData.csrf = csrf;
        //console.log("CSRF Token:", csrf);
        res.cookie('x-csrf-token', csrf);
        res.cookie('TOKEN', csrf);
        res.locals.csrftoken = csrf;
        next();
    });

    // UI routes
    app.use('/', uiRoutes);

    // Start listener
    app.listen(config.port, config.interface, () => console.log(`Listening on port ${config.port}...`));
}

async function getSession(store, id) {
    return new Promise((resolve, reject) => {
        store.get(id, (err, session) => {
            if (err) {
                return reject(err);
            }
            resolve(session);
        });
    });
}