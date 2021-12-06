// https://www.npmjs.com/package/mysql-restapi
// $ npm install mysql --save
// $ npm install mysql-restapi


var express = require('express');
var mysql = require('mysql');
var mysqlrestapi  = require('mysql-restapi');
var dbconfig = require('./connections');
var app = express();
var api = mysqlrestapi(app, dbconfig);

app.use(express.static('public'));


app.listen(8080);

