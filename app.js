//npm modules
var express = require('express');
var bodyParser = require('body-parser');
var http = require('http');
var mongoose = require('mongoose');
var favicon = require('serve-favicon');
var path = require('path');
var passport = require('passport');
var expressSession = require('express-session');
var _ = require('underscore');
var dropboxStrategy = require('passport-dropbox').Strategy;

//local imports
var qbws   = require('./qbws');
var router = require('./routes');
var userModel = _.find(require('./models'), function(model) { return model.modelName === 'user'});

var BRIGHTWATERDROPBOXTEAMID = 'dbtid:AADIihV4QHYt6wCTX1MN2VVwJmdBDiv7tc4';

////////////////////////////////////
//DATABSE SETUP/////////////////////
////////////////////////////////////

mongoose.Promise = global.Promise;

mongoose.connect("mongodb://localhost:27017/saguaro");

var db = mongoose.connection;

db.on("error", console.error.bind(console, "Connection to MongoDB failed"));

db.once("open", function(callback) {
  console.log("Connection to MongoDB successful, running on 27017");
});

////////////////////////////////////
//OAUTH SETUP///////////////////////
////////////////////////////////////


passport.use(new dropboxStrategy({
    consumerKey: 'o2h3e5h6mytkwvg',
    consumerSecret: 'n59fazsvvrs7708',
    callbackURL: 'http://localhost:5000/auth/dropbox/callback' //http://localhost:5000/auth/dropbox/callback' NOTE: Switch to http://saguaroqbtester.herokuapp.com/auth/dropbox/callback if testing on Heroku
  },
  function(token, tokenSecret, profile, done) {
    // First possible error: user is not a member of the team
    if (profile._json.team == null || profile._json.team.team_id != BRIGHTWATERDROPBOXTEAMID) {
      return done('ERROR: User is valid Dropbox user but does not belong to the Brightwater Homes team', false);
    }
    
    // Now we query the db to see if there's a match
    userModel.findOne({ 'dropboxUid': profile._json.uid }, function(error, data) {
      if (error) {
        // Second possible error: the query failed because they aren't yet in the DB
        return done('ERROR: Welcome Brightwater member. You don\'t have an account with Saguaro yet. Your unique Dropbox UID is: ' + profile._json.uid, false);
      }
      console.log(profile._json.uid);
      // Now we store the user's _id in the sid. The _id can later be retrieved in a route callback as req.user
      return done(null, data._id);
    }); 
}));


//Serialize user by 
passport.serializeUser(function(user, cb) {
  cb(null, user);
});

passport.deserializeUser(function(obj, cb) {
    cb(null, obj);
});

//Declaring app after Oauth setup - see https://github.com/passport/express-4.x-twitter-example/blob/master/server.js
var app = express();

app.set('port', (process.env.PORT || 5000));
console.log('Express server running on 5000');

////////////////////////////////////
//MIDDLEWARE////////////////////////
////////////////////////////////////

app.use(favicon(path.join(__dirname, 'public', 'images/favicon.ico')));
app.use(express.static(path.join(__dirname, 'public'))); // accesses Angular app, with ensureLoggedIn as middleware
app.use(expressSession({ secret: 'dillon', resave: true, saveUninitialized: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(passport.initialize());
app.use(passport.session());
app.use('/', router); // routes must declare after passport


////////////////////////////////////
//SERVER SETUP//////////////////////
////////////////////////////////////

//qbws takes care of linking the server to the soap at '/wsdl'...
//The server must get passd to run so that qbws knows
//where to listen

var server = http.createServer(app);
qbws.run(server);



module.exports = app;

////////////////////////////////////

/* Returns the _id of a user in the databse with the matching dropboxUid.
 * if no match, returns null
 */
function getUserIdByDropboxId(dropboxUid) {
  var userModel = _.find(models, function(model) { return model.modelName === 'user'})

  userModel.find({'dropboxUid': dropboxUid}, function(error, data) {
    if (error) {
      return null;
    } else {
      console.log("made it");
      return data._id;
    }
  });
}
