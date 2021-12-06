/*
 *  Copyright 2016 Waverley Labs, LLC
 *
 *  This file is part of SDPcontroller
 *
 *  SDPcontroller is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  SDPcontroller is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */


// Load the libraries
var tls    = require('tls');
var fs     = require('fs');
var mysql  = require("mysql");
var credentialMaker = require('./sdpCredentialMaker');
var prompt = require("prompt");

/**
 * 명령행 인자를 받는 부분
 * @argv[2]: configuration file 위치(경로/파일명)
 *
 * 명령행 인자를 받을 수 있고 만약 없다면 현재 디렉토리에서 .config 파일을
 * config 파일로 설정한다.
 */
if(process.argv.length > 2) {
    try {
        var config = require(process.argv[2]);
    } catch (e) {
        // It isn't accessible
        console.log("Did not find specified config file. Exiting");
        process.exit();
    }
} else {
    var config = require('./config.js');
}

const MSG_SIZE_FIELD_LEN = 4;

const encryptionKeyLenMin = 4;
const encryptionKeyLenMax = 32;
const hmacKeyLenMin = 4;
const hmacKeyLenMax = 128;

// a couple global variables
var db;
var dbPassword = config.dbPassword;
var serverKeyPassword = config.serverKeyPassword;
var myCredentialMaker = new credentialMaker(config);
var connectedGateways = [];
var connectedClients  = [];
var nextConnectionId  = 1;
var checkDatabaseTries = 0;
var checkOpenConnectionsTries = 0;
var lastDatabaseCheck = new Date();
var lastConnectionCheck = new Date();


// check a couple config settings
if(config.encryptionKeyLen < encryptionKeyLenMin
   || config.encryptionKeyLen > encryptionKeyLenMax)
{
    var explanation = "Range is " + encryptionKeyLenMin + " to " + encryptionKeyLenMax;
    throw new sdpConfigException("encryptionKeyLen", explanation);
}

if(config.hmacKeyLen < hmacKeyLenMin
   || config.hmacKeyLen > hmacKeyLenMax)
{
    var explanation = "Range is " + hmacKeyLenMin + " to " + hmacKeyLenMax
    throw new sdpConfigException("hmacKeyLen", explanation);
}

/**
 * myCredentialMaker 객체의 init 함수를 통해 Entry point 함수인
 * startController() 함수가 불리도록 한다.
 * myCredentialMaker init 함수는 certificate authority
 * password 인증절차를 거쳐 실행하도록 한다. password 는 config 파일에 있다.
 */
myCredentialMaker.init(startController);

/**
 * SDP Controller 의 Entry point 함수 이다.
 *
 * TLS 개인 key 의 passphrase 를 입력으로 받거나, config 에서 로드한다.
 * passphrase 가 입력된 후 checkDbPassword() 함수를 실행한다.
 */
function startController() {
    if(serverKeyPassword || !config.serverKeyPasswordRequired)
        checkDbPassword();
    else
    {
        var schema = {
            properties: {
                password: {
                    description: 'Enter server key password',
                    hidden: true,
                    replace: '*',
                    required: true
                }
            }
        };

        prompt.start();

        prompt.get(schema, function(err,result) {
            if(err)
            {
                throw err;
            }
            else
            {
                serverKeyPassword = result.password;
                checkDbPassword();
            }
        });
    }
}

/**
 * SDP Controller 의 DB 암호를 입력받는다.
 *
 * SDP Controller DB 기능을 사용하기 위해 db password 를 입력 받거나
 * config 에서 load한다.
 * load 가 완료되면 startDbPool() 함수를 실행한다.
 */
function checkDbPassword() {
    if(dbPassword || !config.dbPasswordRequired)
        startDbPool();
    else
    {
        var schema = {
            properties: {
                password: {
                    description: 'Enter database password',
                    hidden: true,
                    replace: '*',
                    required: true
                }
            }
        };

        prompt.start();

        prompt.get(schema, function(err,result) {
            if(err)
                console.log(err);
            else
            {
                dbPassword = result.password;
                startDbPool();
            }
        });
    }
}

/**
 * DB 연결 생성에 필요한 parameter 를 넣고 DB pool 을 생성한다.
 * 아래 parameter 는 config 설정으로 assign 한다.
 *
 * @connectionLimit: DB pool 에 생성할 최대 개수를 설정한다.
 * @host: DB host address 를 설정한다.
 * @user: DB User 를 설정한다.
 * @password: DB Password 를 설정한다.
 * @database: DB 이름을 설정한다.
 * Pool 이 만들어 지면 startServer() 함수를 실행한다.
 */
function startDbPool() {
    // set up database pool
    if(config.dbPasswordRequired == false) {
        db = mysql.createPool({
          connectionLimit: config.maxConnections,
          host: config.dbHost,
          user: config.dbUser,
          database: config.dbName,
          debug: false
        });
    } else {
        db = mysql.createPool({
          connectionLimit: config.maxConnections,
          host: config.dbHost,
          user: config.dbUser,
          password: dbPassword, //config.dbPassword,
          database: config.dbName,
          debug: false
        });
    }

    startServer();
}

/**
 * TLS 서버를 설정하고 시작한다.
 *
 * @connectionLimit: DB pool 에 생성할 최대 개수를 설정한다.
 * @host: DB host address 를 설정한다.
 * @user: DB User 를 설정한다.
 * @password: DB Password 를 설정한다.
 * @database: DB 이름을 설정한다.
 * Pool 이 만들어 지면 startServer() 함수를 실행한다.
 */
function startServer() {

    /**
     * DB open connection 들을 모두 closed connection 으로 옮기고
     * open connection 들은 모두 삭제 하여
     * open 중인 connection 이 없도록 정리한다.
     *
     * TODO
     * 현재 DB open connection 및 closed connection 에 추가로
     * DTM open/close connection 이 새롭게 추가되어 있다.
     * 이 테이블도 기존 테이블처럼 정리가 필요하다.
     */
    cleanOpenConnectionTable();

    /**
     * 설정 변경을 감지하는 refresh_trigger 테이블을 주기적으로 모니터 하여
     * 연결되어 있는 SDP Gateway 에게 SDP Client credential을 다시 제공한다.
     * refresh_trigger insert 는 특정 테이블 스키마 제약으로 구현된다.
     *
     * @func: 수행될 함수명이 지정된다.
     * @time: 함수가 실행될 시간을 지정한다. millisecond 단위로
     * @arg: 함수에 넘겨줄 parameter 를 지정한다.
     */
    setTimeout(checkDatabaseForUpdates,
               config.databaseMonitorInterval,
               config.databaseMonitorInterval);

    /**
     * TLS server 옵션을 설정한다.
     *
     * @key: TLS server 개인키 파일을 위치를 입력한다.
     * @passphrase: 개인키의 passphrase 를 입력한다.
     * @cert: TLS server 인증서 위치를 입력한다.
     * @requestCert: SDP Client TLS 연결 중 인증서 요청 단계를 설정한다.
     * @rejectUnauthorized: 인증실패 시 연결 종료 여부를 설정한다.
     * @ca: SDP client 를 인증서를 verify 할 CA 인증서 위치를 입력한다.
     */
    const options = {
        key: fs.readFileSync(config.serverKey),
        passphrase: serverKeyPassword,
        cert: fs.readFileSync(config.serverCert),
        requestCert: true,
        rejectUnauthorized: true,
        ca: [ fs.readFileSync(config.caCert) ]
    };

    /**
     * TLS server 를 시작한다.
     *
     * @option: TLS server option 을 설정한다.
     * @even handler: SDP Client 와 연결이 발생 했을 때 처리 및 연결과 관련된
     * 여러 이벤트들을 처리하는 함수 등록
     */
    var server = tls.createServer(options, function (socket) {

        if(config.debug)
          console.log("Socket connection started");

        var action = null;
        var memberDetails = null;
        var dataTransmitTries = 0;
        var credentialMakerTries = 0;
        var databaseConnTries = 0;
        var badMessagesReceived = 0;
        var newKeys = null;
        var accessRefreshDue = false;
        var connectionId = nextConnectionId;
        var expectedMessageSize = 0;
        var totalSizeBytesReceived = 0;
        var sizeBytesNeeded = 0;
        var dataBytesToRead = 0;
        var totalMessageBytesReceived = 0;
        var sizeBuffer = Buffer.allocUnsafe(MSG_SIZE_FIELD_LEN);
        var messageBuffer = Buffer.allocUnsafe(0);

        if(Number.MAX_SAFE_INTEGER == connectionId)   // 9007199254740991
            nextConnectionId = 1;
        else
            nextConnectionId += 1;

        /**
         * 이 위치까지 코드 흐름이 온다면 SDP Client 의 인증 및 TLS 연결이
         * 완료된 상태임.
         *
         * 연결된 SDP Client 의 인증서에서 subject CN 값을 추출한다.
         * CN 값은 sdp id 라는 SDP Client 및 Gateway 를 구분하는 식별자로
         * 사용되며 DB 에 이미 등록되어 있는 사용자 이어야 한다.
         */
        var sdpId = parseInt(socket.getPeerCertificate().subject.CN);

        console.log("Connection from SDP ID " + sdpId + ", connection ID " + connectionId);

        /**
         * socketTimeout 이 config 파일에 설정되어 있다면
         * config 에 설정된 시간 만큼 TLS 연결에 변화가 없다면
         * SDP Gateway 일경우 DB 에서 open connection 을
         * closed connection 으로 정리하고,
         * 메모리에 관리중인 TLS 연결 정보를 삭제한다.
         *
         * TODO
         * dtm open/close connection 테이블이 추가되어
         * 기존 open/close connection 정리와 동일하게 적용되어야 한다.
         */
        if(config.socketTimeout)
            socket.setTimeout(config.socketTimeout, function() {
                console.error("Connection to SDP ID " + sdpId + ", connection ID " + connectionId + " has timed out. Disconnecting.");
                //if(memberDetails.type === 'gateway') {
                //    removeOpenConnections(connectionId);
                //}
                //removeFromConnectionList(memberDetails, connectionId);
            });

        /**
         * SDP Client/Gateway 가 요청한 데이터 이벤트를 처리한다.
         *
         * @data: 이벤트 이름을 입력한다.
         * @event handler: 이벤트를 처리하는 함수를 등록한다.(data 에 수신한 데이터가 저장된다.)
         *
         * 이벤트 처리함수는 다음과 같은 타입의 메시지를 처리한다.
         * |---Payload Data Len(4byte)---|---Payload Data(as the Payload Data len)---|
         * 만약 데이터가 위 포맷만큼 수신되지 않았으면 메시지 버퍼에 넣어 보관하고 나머지 데이터가 오면
         * 모두 수신되면 처리 한다.
         * 만약 데이터가 지정된 길이보다 길다면 메시지 버퍼를 비우고 에러 처리한다.
         */
        socket.on('data', function (data) {
            while(data.length) {
                // 첫 루프를 구분하기 위함.
                if(expectedMessageSize == 0) {
                    // 첫 루프 이면 4 (MSG_SIZE_FIELD_LEN(4byte) - 0 이면 MSG_SIZE_FIELD_LEN 은 4)
                    sizeBytesNeeded = MSG_SIZE_FIELD_LEN - totalSizeBytesReceived;

                    // 수신 데이터 길이가 데이터 길이(4Byte) 보다 작다면 sizeBuffer 에 수신한 데이터 만큼 저장하고 return 함.
                    if( data.length < sizeBytesNeeded ) {
                        data.copy(sizeBuffer, totalSizeBytesReceived, 0, data.length);
                        totalSizeBytesReceived += data.length;
                        data = Buffer.allocUnsafe(0);
                        return;
                    }

                    // sizeBuffer 에 수신한 데이터의 첫 위치부터 4byte까지 복사함.
                    data.copy(sizeBuffer, totalSizeBytesReceived, 0, sizeBytesNeeded);
                    // data size 를 구한 상태를 totalSizeBytesReceived 값을 채워 표시함.
                    totalSizeBytesReceived = MSG_SIZE_FIELD_LEN;
                    // data size 를 32bit 정수값으로 읽어옮
                    expectedMessageSize = sizeBuffer.readUInt32BE(0);
                    // 데이터 버퍼 할당
                    messageBuffer = Buffer.allocUnsafe(0);
                }

                // 수신한 데이터가 4바이트 데이터 길이 필드보다 크면
                if( data.length > sizeBytesNeeded ) {

                    if( (data.length - sizeBytesNeeded) < (expectedMessageSize - totalMessageBytesReceived) ){
                        // 수신한 데이터가 예상한 길이보다 작으면 수신한 데이터 사이즈를 dataBytesToRead 에 저장함.
                        dataBytesToRead = data.length - sizeBytesNeeded;
                    }
                    else {
                        // 수신한 데이터가 예상한 길이보다 크거나 같으면 수신한 데이터 사이즈 필드에 기록된 길이 만큼 dataBytesToRead 에 저장함.
                        dataBytesToRead = expectedMessageSize - totalMessageBytesReceived;
                    }

                    // 읽을 데이터 크기를 기억한다.
                    totalMessageBytesReceived += dataBytesToRead;
                    // 수신된 데이터에서 읽을 데이터 사이즈 만큼만 복사해서 메시지 버퍼의 끝에 채워 넣는다.
                    messageBuffer = Buffer.concat([messageBuffer,
                        data.slice(sizeBytesNeeded, sizeBytesNeeded+dataBytesToRead)],
                        totalMessageBytesReceived);
                }

                // 읽을 데이터가 데이터 길이 필드의 정의된 길이와 같아 메시지를 처리할 준비가 되었다면.
                if(totalMessageBytesReceived == expectedMessageSize) {
                    expectedMessageSize = 0;
                    totalSizeBytesReceived = 0;
                    totalMessageBytesReceived = 0;
                    // 메시지를 처리한다.
                    processMessage(messageBuffer);
                }

                // 수신 버퍼에 읽고 남은 데이터를 채워 넣고, 루프를 다시 돌 수 있게 해 준다.
                data = data.slice(sizeBytesNeeded+dataBytesToRead);
                sizeBytesNeeded = 0;
                dataBytesToRead = 0;

            }
        });

        // 연결종료
        socket.on('end', function () {
            console.log("Connection to SDP ID " + sdpId + ", connection ID " + connectionId + " closed.");
            if(memberDetails.type === 'gateway') {
                removeOpenConnections(connectionId);
            }
            removeFromConnectionList(memberDetails, connectionId);
        });

        // 연결에러
        socket.on('error', function (error) {
            console.error(error);
            if(memberDetails.type === 'gateway') {
                removeOpenConnections(connectionId);
            }
            removeFromConnectionList(memberDetails, connectionId);
            socket.end();
        });

        // Find sdpId in the database
        // sdp id 에 해당하는 정보가 DB 에 있는지 확인하고
        /**
         * sdp id에 대한 정보를 DB 에서 찾는다.
         *
         * @handler: pool 에서 DB connection 을 가져올 때 처리 핸들러 함수
         *
         * sdp id 를 key 로 DB 검색을 하여 검색된 레코드를 메모리에 저장한다.
         * sdp id, connection id, 현재시간, socket 객체를 메모리에 저장한다.
         * sdp id 에 해당하는 credential 의 업데이트 시점이 되었으면 업데이트 후
         * DB 에 정보저장 후 SDP Client 에게 해당 정보를 전송해 준다.
         * 만약 sdp id 를 찾을 수 없다면 JSON type 메시지를 SDP Client 에게 전송해 준다.
         */

        db.getConnection(function(error,connection){
            if(error){
                console.error("Error connecting to database: " + error);
                writeToSocket(socket, JSON.stringify({action: 'database_error'}), true);
                return;
            }

            var databaseErrorCallback = function(error) {
                connection.removeListener('error', databaseErrorCallback);
                connection.release();
                console.error("Error from database connection: " + error);
                return;
            };

            connection.on('error', databaseErrorCallback);

            connection.query('SELECT * FROM `sdpid` WHERE `sdpid` = ?', [sdpId],
            function (error, rows, fields) {
                connection.removeListener('error', databaseErrorCallback);
                connection.release();
                if (error) {
                    console.error("Query returned error: " + error);
                    console.error(error);
                    writeToSocket(socket, JSON.stringify({action: 'database_error'}), true);
                } else if (rows.length < 1) {
                    console.error("SDP ID not found, notifying and disconnecting");
                    writeToSocket(socket, JSON.stringify({action: 'unknown_sdp_id'}), true);
                } else if (rows.length > 1) {
                    console.error("Query returned multiple rows for SDP ID: " + sdpId);
                    writeToSocket(socket, JSON.stringify({action: 'database_error'}), true);
                } else if (rows[0].valid == 0) {
                    console.error("SDP ID " + sdpId+" disabled. Disconnecting.");
                    writeToSocket(socket, JSON.stringify({action: 'sdpid_unauthorized'}), true);
                } else {

                    memberDetails = rows[0];

                    // add the connection to the appropriate list
                    var destList;
                    if(memberDetails.type === 'gateway') {
                        destList = connectedGateways;
                    } else {
                        destList = connectedClients;
                    }

                    // first ensure no duplicate connection entries are left around
                    for(var idx = 0; idx < destList.length; idx++) {
                        if(destList[idx].sdpId == memberDetails.sdpid) {
                            // this next call triggers socket.on('end'...
                            // which removes the entry from the connection list
                            writeToSocket(destList[idx].socket,
                                JSON.stringify({action: 'duplicate_connection'}),
                                true
                            );

                            // the check above means there should never be more than 1 match
                            // and letting the loop keep checking introduces race condition
                            // because the .end callback also loops through the list
                            // and will delete one list entry
                            break;
                        }
                    }

                    // now add the connection to the right list
                    newEntry = {
                        sdpId: memberDetails.sdpid,
                        connectionId: connectionId,
                        connectionTime: new Date(),
                        socket
                    };

                    //if(memberDetails.type === 'gateway') {
                    //    newEntry.connections = null;
                    //}

                    destList.push(newEntry);


                    if (config.debug) {
                        console.log("Connected gateways: \n", connectedGateways, "\n");
                        console.log("Connected clients: \n", connectedClients, "\n");
                        console.log("Data for client is: ");
                        console.log(memberDetails);
                    }

                    // possibly send credential update
                    var now = new Date();
                    if(now > memberDetails.cred_update_due) {
                        handleCredentialUpdate();
                    } else {
                        writeToSocket(socket, JSON.stringify({action: 'credentials_good'}), false);
                    }

                }

            });

        });


        // Parse SDP messages
        /**
         * SDP Client/Gateway 로 부터 전송된 메시지를 분석하고 처리한다.
         * @data: send 가 전송한 메시지를 read 한 메시지 버퍼
         */
        function processMessage(data) {
            if(config.debug) {
                console.log("Message Data Received: ");
                console.log(data.toString());
            }

            // Ignore message if not yet ready
            // Clients are not supposed to send the first message
            if(!memberDetails){
                console.log("Ignoring premature message.");
                return;
            }

            try {
                var message = JSON.parse(data);
            }
            catch (err) {
                console.error("Error processing the following received data: \n" + data.toString());
                console.error("JSON parse failed with error: " + err);
                handleBadMessage(data.toString());
                return;
            }

            if(config.debug) {
                console.log("Message parsed");
                console.log("Message received from SDP ID " + memberDetails.sdpid);
                console.log("JSON-Parsed Message Data Received: ");
                for(var myKey in message) {
                    console.log("key: " + myKey + "   value: " + message[myKey]);
                }
            }


            // JSON type 메시지에서 'action' property 를 가져옮.
            action = message['action'];
            if (action === 'credential_update_request') {
                // SDP Client/Gateway 에서 SPA info, 인증서, pkey 를 업데이트 하기 위해 보내온 요청(사용안함).
                handleCredentialUpdate();
            } else if (action === 'credential_update_ack')  {
                // SDP Controller 가 보낸 credential 에 대한 응답(사용안함).
                handleCredentialUpdateAck();
            } else if (action === 'keep_alive') {
                // TCP 연결을 유지 및 Health check 용도로 SDP Client/Gateway 가 보내온 요청
                handleKeepAlive();
            } else if (action === 'service_refresh_request') {
                // 사용안함.
                handleServiceRefresh();
            } else if (action === 'service_ack') {
                // 사용안함.
                handleServiceAck();
            } else if (action === 'access_refresh_request') {
                // SDP Gateway 가 자신의 SDP Client 정보를 제공받기 위해 보내온 요청
                handleAccessRefresh();
            } else if (action === 'access_update_request') {
                // 사용안함.
                handleAccessUpdate(message);
            } else if (action === 'access_ack') {
                // access_refresh_request 에 대한 응답.
                handleAccessAck();
            } else if (action === 'client_spainfo_request') {
                // SDP Client 가 SPA 정보를 제공받기 위해 보내온 요청
                handleClientSpainfoRequest();
            } else if (action === 'spainfo_ack') {
                // spainfo_ack 에 대한 응답.
                handleSpainfoAck();
            } else if (action === 'connection_update') {
                // DTM 의 접속정보들을 DB 에 update 하기 위해 보내온 요청
                handleConnectionUpdate(message);
            } else if (action === 'bad_message') {
                // doing nothing with these yet
                return;
            } else {
                console.error("Invalid message received, invalid or missing action");
                handleBadMessage(data.toString());
            }
        }

        function handleKeepAlive() {
            if (config.debug) {
                console.log("Received keep_alive from SDP ID "+memberDetails.sdpid+", responding now.");
            }

            var keepAliveMessage = {
                action: 'keep_alive'
            };

            // For testing only, send a bunch of copies fast
            if (config.testManyMessages > 0) {
                console.log("Sending " +config.testManyMessages+ " extra messages first for testing rather than just 1");
                var jsonMsgString = JSON.stringify(keepAliveMessage);
                for(var ii = 0; ii < config.testManyMessages; ii++) {
                    writeToSocket(socket, jsonMsgString, false);
                }
            }

            writeToSocket(socket, JSON.stringify(keepAliveMessage), false);
            //console.log("keepAlive message written to socket");

        }


        function handleCredentialUpdate() {
            if (dataTransmitTries >= config.maxDataTransmitTries) {
                // Data transmission has failed
                console.error("Data transmission to SDP ID " + memberDetails.sdpid +
                    " has failed after " + (dataTransmitTries+1) + " attempts");
                console.error("Closing connection");
                socket.end();
                return;
            }

            // get the credentials
            myCredentialMaker.getNewCredentials(memberDetails, function(err, data){
                if (err) {

                    credentialMakerTries++;

                    if (credentialMakerTries >= config.maxCredentialMakerTries) {
                        // Credential making has failed
                        console.error("Failed to make credentials for SDP ID " + memberDetails.sdpid +
                                  " " + credentialMakerTries + " times.");
                        console.error("Closing connection");

                        var credErrMessage = {
                            action: 'credential_update_error',
                            data: 'Failed to generate credentials '+credentialMakerTries+
                                ' times. Disconnecting.'
                        };

                        writeToSocket(socket, JSON.stringify(credErrMessage), true);
                        return;
                    }

                    // otherwise, just notify requestor of error
                    var credErrMessage = {
                        action: 'credential_update_error',
                        data: 'Could not generate new credentials',
                    };


                    console.log("Sending credential_update_error message to SDP ID " +
                        memberDetails.sdpid + ", failed attempt: " + credentialMakerTries);
                    writeToSocket(socket, JSON.stringify(credErrMessage), false);

                } else {
                    // got credentials, send them over
                    var newCredMessage = {
                        action: 'credential_update',
                        data
                    };

                    var updated = new Date();
                    var expires = new Date();
                    expires.setDate(expires.getDate() + config.daysToExpiration);
                    expires.setHours(0);
                    expires.setMinutes(0);
                    expires.setSeconds(0);
                    expires.setMilliseconds(0);

                    newKeys = {
                        spa_encryption_key_base64: data.spa_encryption_key_base64,
                        spa_hmac_key_base64: data.spa_hmac_key_base64,
                        updated,
                        expires
                    };

                    console.log("Sending credential_update message to SDP ID " + memberDetails.sdpid + ", attempt: " + dataTransmitTries);
                    dataTransmitTries++;
                    writeToSocket(socket, JSON.stringify(newCredMessage), false);

                }

            });
        } // END FUNCTION handleCredentialUpdate


        function handleCredentialUpdateAck()  {
            console.log("Received credential update acknowledgement from SDP ID "+memberDetails.sdpid+
                ", data successfully delivered");

            // store the necessary info in the database
            storeKeysInDatabase();

        }  // END FUNCTION handleCredentialUpdateAck


        function notifyGateways() {
            // get database connection
            db.getConnection(function(error,connection){
                if(error){
                    console.error("Error connecting to database in preparation " +
                                  "to notify gateways of a client's credential update: " + error);

                    // notify the requestor of our database troubles
                    writeToSocket(socket,
                        JSON.stringify({
                            action: 'notify_gateways_error',
                            data: 'Database unreachable. Gateways not notified of credential update.'
                        }),
                        false
                    );

                    return;
                }

                var databaseErrorCallback = function(error) {
                    connection.removeListener('error', databaseErrorCallback);
                    connection.release();
                    console.error("Error from database connection: " + error);
                    return;
                };

                connection.on('error', databaseErrorCallback);

                // this next query requires a simple array of only
                // the sdp ids listed in connectedGateways
                var gatewaySdpIdList = [];
                for(var idx = 0; idx < connectedGateways.length; idx++) {
                    gatewaySdpIdList.push(connectedGateways[idx].sdpId);
                }

                if(gatewaySdpIdList.length < 1)
                {
                    console.log("No relevant gateways to notify regarding credential update to SDP ID "+memberDetails.sdpid);
                    return;
                }

                if(config.allowLegacyAccessRequests)
                {
                    connection.query(
                        '(SELECT ' +
                        '    `service_gateway`.`gateway_sdpid`,  ' +
                        '    `service_gateway`.`service_id`, ' +
                        '    `service_gateway`.`protocol`, ' +
                        '    `service_gateway`.`port`, ' +
                        '    `sdpid`.`encrypt_key`,  ' +
                        '    `sdpid`.`hmac_key` ' +
                        'FROM `service_gateway` ' +
                        '    JOIN `sdpid_service` ' +
                        '        ON `sdpid_service`.`service_id` = `service_gateway`.`service_id` ' +
                        '    JOIN `sdpid` ' +
                        '        ON `sdpid`.`sdpid` = `sdpid_service`.`sdpid` ' +
                        'WHERE ' +
                        '    `service_gateway`.`gateway_sdpid` IN (?) AND ' +
                        '    `sdpid`.`sdpid` = ? )' +
                        'UNION ' +
                        '(SELECT ' +
                        '    `service_gateway`.`gateway_sdpid`, ' +
                        '    `group_service`.`service_id`,  ' +
                        '    `service_gateway`.`protocol`, ' +
                        '    `service_gateway`.`port`, ' +
                        '    `sdpid`.`encrypt_key`,  ' +
                        '    `sdpid`.`hmac_key` ' +
                        'FROM `service_gateway` ' +
                        '    JOIN `group_service` ' +
                        '        ON `group_service`.`service_id` = `service_gateway`.`service_id` ' +
                        '    JOIN `group` ' +
                        '        ON `group`.`id` = `group_service`.`group_id` ' +
                        '    JOIN `user_group` ' +
                        '        ON `user_group`.`group_id` = `group`.`id` ' +
                        '    JOIN `sdpid` ' +
                        '        ON `sdpid`.`user_id` = `user_group`.`user_id` ' +
                        'WHERE ' +
                        '    `service_gateway`.`gateway_sdpid` IN (?) AND ' +
                        '    `sdpid`.`sdpid` = ? AND ' +
                        '    `group`.`valid` = 1 )' +
                        'ORDER BY `gateway_sdpid` ',
                        [gatewaySdpIdList,
                         memberDetails.sdpid,
                         gatewaySdpIdList,
                         memberDetails.sdpid],
                        function (error, rows, fields) {
                            connection.removeListener('error', databaseErrorCallback);
                            connection.release();
                            if(error) {
                                console.error("Access data query returned error: " + error);
                                writeToSocket(socket,
                                    JSON.stringify({
                                        action: 'notify_gateways_error',
                                        data: 'Database error. Gateways not notified of credential update.'
                                    }),
                                    false
                                );
                                return;
                            }

                            if(rows.length == 0) {
                                console.log("No relevant gateways to notify regarding credential update to SDP ID "+memberDetails.sdpid);
                                return;
                            }

                            var thisRow = rows[0];
                            var currentGatewaySdpId = thisRow.gateway_sdpid;
                            var open_ports = thisRow.protocol + "/" + thisRow.port;
                            var service_list = thisRow.service_id.toString();
                            var encryptKey = thisRow.encrypt_key;
                            var hmacKey = thisRow.hmac_key;

                            for(var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                                thisRow = rows[rowIdx];

                                if(thisRow.gateway_sdpid != currentGatewaySdpId) {
                                    currentGatewaySdpId = thisRow.gateway_sdpid;
                                    service_list = thisRow.service_id.toString();
                                    open_ports = thisRow.protocol + "/" + thisRow.port;
                                    encryptKey = thisRow.encrypt_key;
                                    hmacKey = thisRow.hmac_key;
                                } else if(rowIdx != 0) {
                                    service_list += ", " + thisRow.service_id.toString();
                                    open_ports += ", " + thisRow.protocol + "/" + thisRow.port;
                                }

                                // if this is the last data row or the next is a different gateway
                                if( (rowIdx + 1) == rows.length ||
                                    rows[rowIdx + 1].gateway_sdpid != currentGatewaySdpId ) {

                                    // send off this stanza data
                                    notifyGateway(currentGatewaySdpId,
                                                  memberDetails.sdpid,
                                                  service_list,
                                                  open_ports,
                                                  encryptKey,
                                                  hmacKey);
                                }
                            }

                            // only after successful notification
                            if(memberDetails.type === 'client' &&
                               !config.keepClientsConnected)
                            {
                                socket.end();
                            }


                        } // END QUERY CALLBACK FUNCTION

                    );  // END QUERY DEFINITION

                }  // END IF allowLegacyAccessRequests
                else
                {
                    connection.query(
                        '(SELECT ' +
                        '    `service_gateway`.`gateway_sdpid`,  ' +
                        '    `service_gateway`.`service_id`, ' +
                        '    `sdpid`.`encrypt_key`,  ' +
                        '    `sdpid`.`hmac_key` ' +
                        'FROM `service_gateway` ' +
                        '    JOIN `sdpid_service` ' +
                        '        ON `sdpid_service`.`service_id` = `service_gateway`.`service_id` ' +
                        '    JOIN `sdpid` ' +
                        '        ON `sdpid`.`sdpid` = `sdpid_service`.`sdpid` ' +
                        'WHERE ' +
                        '    `service_gateway`.`gateway_sdpid` IN (?) AND ' +
                        '    `sdpid`.`sdpid` = ? )' +
                        'UNION ' +
                        '(SELECT ' +
                        '    `service_gateway`.`gateway_sdpid`, ' +
                        '    `group_service`.`service_id`,  ' +
                        '    `sdpid`.`encrypt_key`,  ' +
                        '    `sdpid`.`hmac_key` ' +
                        'FROM `service_gateway` ' +
                        '    JOIN `group_service` ' +
                        '        ON `group_service`.`service_id` = `service_gateway`.`service_id` ' +
                        '    JOIN `group` ' +
                        '        ON `group`.`id` = `group_service`.`group_id` ' +
                        '    JOIN `user_group` ' +
                        '        ON `user_group`.`group_id` = `group`.`id` ' +
                        '    JOIN `sdpid` ' +
                        '        ON `sdpid`.`user_id` = `user_group`.`user_id` ' +
                        'WHERE ' +
                        '    `service_gateway`.`gateway_sdpid` IN (?) AND ' +
                        '    `sdpid`.`sdpid` = ? AND ' +
                        '    `group`.`valid` = 1 )' +
                        'ORDER BY `gateway_sdpid` ',
                        [gatewaySdpIdList,
                         memberDetails.sdpid,
                         gatewaySdpIdList,
                         memberDetails.sdpid],
                        function (error, rows, fields) {
                            connection.removeListener('error', databaseErrorCallback);
                            connection.release();
                            if(error) {
                                console.error("Access data query returned error: " + error);
                                writeToSocket(socket,
                                    JSON.stringify({
                                        action: 'notify_gateways_error',
                                        data: 'Database error. Gateways not notified of credential update.'
                                    }),
                                    false
                                );
                                return;
                            }

                            if(rows.length == 0) {
                                console.log("No relevant gateways to notify regarding credential update to SDP ID "+memberDetails.sdpid);
                                return;
                            }

                            var thisRow = rows[0];
                            var currentGatewaySdpId = thisRow.gateway_sdpid;
                            var service_list = thisRow.service_id.toString();
                            var encryptKey = thisRow.encrypt_key;
                            var hmacKey = thisRow.hmac_key;

                            for(var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                                thisRow = rows[rowIdx];

                                if(thisRow.gateway_sdpid != currentGatewaySdpId) {
                                    currentGatewaySdpId = thisRow.gateway_sdpid;
                                    service_list = thisRow.service_id.toString();
                                    encryptKey = thisRow.encrypt_key;
                                    hmacKey = thisRow.hmac_key;
                                } else if(rowIdx != 0) {
                                    service_list += ", " + thisRow.service_id.toString();
                                }

                                // if this is the last data row or the next is a different gateway
                                if( (rowIdx + 1) == rows.length ||
                                    rows[rowIdx + 1].gateway_sdpid != currentGatewaySdpId ) {

                                    // send off this stanza data
                                    notifyGateway(currentGatewaySdpId,
                                                  memberDetails.sdpid,
                                                  service_list,
                                                  null,
                                                  encryptKey,
                                                  hmacKey);
                                }
                            }

                            // only after successful notification
                            if(memberDetails.type === 'client' &&
                               !config.keepClientsConnected)
                            {
                                socket.end();
                            }


                        } // END QUERY CALLBACK FUNCTION

                    );  // END QUERY DEFINITION

                }  // END ELSE (i.e. NOT allowLegacyAccessRequests)

            });  // END DATABASE CONNECTION CALLBACK

        } // END FUNCTION notifyGateways


        function notifyGateway(gatewaySdpId, clientSdpId, service_list, open_ports, encKey, hmacKey) {

            var gatewaySocket = null;

            // get the right socket
            for(var idx = 0; idx < connectedGateways.length; idx++) {
                if(connectedGateways[idx].sdpId == gatewaySdpId) {
                    gatewaySocket = connectedGateways[idx].socket;
                    break;
                }
            }

            debugger;

            if(!gatewaySocket) {
                console.log("Attempted to notify gateway with SDP ID " +gatewaySdpId+
                            " of a client's updated credentials, but socket not found.");
                return;
            }

            if(open_ports)
            {
                var data = [{
                    sdp_id: clientSdpId,
                    source: "ANY",
                    service_list: service_list,
                    open_ports: open_ports,
                    spa_encryption_key_base64: encKey,
                    spa_hmac_key_base64: hmacKey
                }];
            }
            else
            {
                var data = [{
                    sdp_id: clientSdpId,
                    source: "ANY",
                    service_list: service_list,
                    spa_encryption_key_base64: encKey,
                    spa_hmac_key_base64: hmacKey
                }];
            }

            if(config.debug) {
                console.log("Access update data to send to "+gatewaySdpId+": \n", data);
            }

            console.log("Sending access_update message to SDP ID " + gatewaySdpId);

            writeToSocket(gatewaySocket,
                JSON.stringify({
                    action: 'access_update',
                    data
                }),
                false
            );


        } // END FUNCTION notifyGateway


        function removeFromConnectionList(details, connectionId) {
            var theList = null;
            var found = false;

            if(details.type === 'client') {
                var theList = connectedClients;
                console.log("Searching connected client list for SDP ID " + details.sdpid + ", connection ID " + connectionId);
            } else {
                var theList = connectedGateways;
                console.log("Searching connected gateway list for SDP ID " + details.sdpid + ", connection ID " + connectionId);
            }

            for(var idx = 0; idx < theList.length; idx++) {
                if(theList[idx].connectionId == connectionId) {
                    theList.splice(idx, 1);
                    found = true;
                    break;
                }
            }

            if(found) {
                console.log("Found and removed SDP ID "+details.sdpid+ ", connection ID " + connectionId +" from connection list");
            } else {
                console.log("Did not find SDP ID "+details.sdpid+ ", connection ID " + connectionId +" in the connection list");
            }
        }


        function handleServiceRefresh() {
            if (dataTransmitTries >= config.maxDataTransmitTries) {
                // Data transmission has failed
                console.error("Data transmission to SDP ID " + memberDetails.sdpid +
                  " has failed after " + (dataTransmitTries+1) + " attempts");
                console.error("Closing connection");
                socket.end();
                return;
            }

            db.getConnection(function(error,connection){
                if(error){
                    console.error("Error connecting to database: " + error);

                    // notify the requestor of our database troubles
                    writeToSocket(socket,
                        JSON.stringify({
                            action: 'service_refresh_error',
                            data: 'Database unreachable. Try again soon.'
                        }),
                        false
                    );

                    return;
                }

                var databaseErrorCallback = function(error) {
                  connection.removeListener('error', databaseErrorCallback);
                  connection.release();
                  console.error("Error from database connection: " + error);
                  return;
                };

                connection.on('error', databaseErrorCallback);

                connection.query(
                    'SELECT ' +
                    '    `service_gateway`.`protocol`,  ' +
                    '    `service_gateway`.`service_id`,  ' +
                    '    `service_gateway`.`port`, ' +
                    '    `service_gateway`.`nat_ip`, ' +
                    '    `service_gateway`.`nat_port` ' +
                    'FROM `service_gateway` ' +
                    'WHERE `service_gateway`.`gateway_sdpid` = ? ',
                    [memberDetails.sdpid],
                    function (error, rows, fields) {
                        connection.removeListener('error', databaseErrorCallback);
                        connection.release();
                        if(error) {
                            console.error("Service data query returned error: " + error);
                            writeToSocket(socket,
                                JSON.stringify({
                                    action: 'service_refresh_error',
                                    data: 'Database error. Try again soon.'
                                }),
                                false
                            );
                            return;
                        }

                        var data = [];
                        for(var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                            var thisRow = rows[rowIdx];
                            if(thisRow.nat_ip != '' && thisRow.nat_port != 0) {
                                data.push({
                                    service_id: thisRow.service_id,
                                    proto: thisRow.protocol,
                                    port: thisRow.port,
                                    nat_ip: thisRow.nat_ip,
                                    nat_port: thisRow.nat_port,
                                });
                            } else {
                                data.push({
                                    service_id: thisRow.service_id,
                                    proto: thisRow.protocol,
                                    port: thisRow.port,
                                });
                            }
                        }

                        if(config.debug) {
                            console.log("Service refresh data to send: \n", data, "\n");
                        }

                        dataTransmitTries++;
                        console.log("Sending service_refresh message to SDP ID " +
                            memberDetails.sdpid + ", attempt: " + dataTransmitTries);

                        writeToSocket(socket,
                            JSON.stringify({
                                action: 'service_refresh',
                                data
                            }),
                            false
                        );

                    } // END QUERY CALLBACK FUNCTION

                );  // END QUERY DEFINITION

            });  // END DATABASE CONNECTION CALLBACK

        }  // END FUNCTION handleServiceRefresh


        function handleServiceAck()  {
            console.log("Received service data acknowledgement from SDP ID "+memberDetails.sdpid+
                ", data successfully delivered");

            clearStateVars();

        }  // END FUNCTION handleServiceAck

        function handleSpainfoAck() {
            console.log("Received SPA Info data acknowledgement from SDP ID "+memberDetails.sdpid+
                ", data successfully delivered");

            clearStateVars();
        }

        function handleClientSpainfoRequest() {
            if (dataTransmitTries >= config.maxDataTransmitTries) {
                // Data transmission has failed
                console.error("Data transmission to SDP ID " + memberDetails.sdpid +
                  " has failed after " + (dataTransmitTries+1) + " attempts");
                console.error("Closing connection");
                socket.end();
                return;
            }

            db.getConnection(function(error,connection){
                if(error){
                    console.error("Error connecting to database: " + error);

                    // notify the requestor of our database troubles
                    writeToSocket(socket,
                        JSON.stringify({
                            action: 'client_spainfo',
                            data: 'Database unreachable. Try again soon.'
                        }),
                        false
                    );

                    return;
                }

                var databaseErrorCallback = function(error) {
                    connection.removeListener('error', databaseErrorCallback);
                    connection.release();
                    console.error("Error from database connection: " + error);
                    return;
                };

                connection.on('error', databaseErrorCallback);

                connection.query(
                    '(SELECT ' +
                    '   `sdpid`.`sdpid`, ' +
                    '   `service_gateway`.`service_id`, ' +
                    '   `sdpid`.`encrypt_key`, ' +
                    '   `sdpid`.`hmac_key`, ' +
                    '   `service_gateway`.`protocol`, ' +
                    '   `service_gateway`.`port`, ' +
                    '   `gateway`.`address` ' +
                    'FROM `sdpid_service` ' +
                    '   JOIN `sdpid` ' +
                    '       ON `sdpid`.`sdpid` = `sdpid_service`.`sdpid` ' +
                    '   JOIN `service_gateway`  ' +
                    '       ON `service_gateway`.`service_id` = `sdpid_service`.`service_id` ' +
                    '   JOIN `gateway` ' +
                    '       ON `gateway`.`sdpid` = `service_gateway`.`gateway_sdpid` ' +
                    'WHERE ' +
                    '   `sdpid_service`.`sdpid` = ? )',
                    [memberDetails.sdpid],
                    function (error, rows, fields) {
                        connection.removeListener('error', databaseErrorCallback);
                        connection.release();
                        if(error) {
                            console.error("Client SPA Info data query returned error: " + error);
                            writeToSocket(socket,
                                JSON.stringify({
                                    action: 'client_spainfo',
                                    data: 'Database error. Try again soon.'
                                }),
                                false
                            );
                            return;
                        }

                        var data = [];
                        var dataIdx = 0;
                        var currentSdpId = 0;
                        for(var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                            var thisRow = rows[rowIdx];
                            dataIdx = data.length - 1;
                            if(thisRow.sdpid != currentSdpId) {
                                currentSdpId = thisRow.sdpid;
                                data.push({
                                    sdp_id: thisRow.sdpid,
                                    service_list: thisRow.service_id.toString(),
                                    source: "ANY",
                                    encrypt_key: thisRow.encrypt_key,
                                    hmac_key: thisRow.hmac_key,
                                    open_ports: thisRow.protocol + "/" +thisRow.port,
                                    gw_addr: thisRow.address
                                });
                            } else {
                                data[dataIdx].service_list += "," + thisRow.service_id.toString();
                                data[dataIdx].open_ports += "," + thisRow.protocol + "/" +thisRow.port;
                            }
                        }

                        if(config.debug) {
                            console.log("Client SPA Info data to send: \n", data, "\n");
                        }

                        dataTransmitTries++;
                        console.log("Sending client_spainfo message to SDP ID " +
                            memberDetails.sdpid + ", attempt: " + dataTransmitTries);

                        writeToSocket(socket,
                            JSON.stringify({
                                action: 'client_spainfo',
                                data
                            }),
                            false
                        );

                    } // END QUERY CALLBACK FUNCTION

                );  // END QUERY DEFINITION


            });  // END DATABASE CONNECTION CALLBACK

        }  // END FUNCTION handleAccessRefresh

        function handleAccessRefresh() {
            if (dataTransmitTries >= config.maxDataTransmitTries) {
                // Data transmission has failed
                console.error("Data transmission to SDP ID " + memberDetails.sdpid +
                  " has failed after " + (dataTransmitTries+1) + " attempts");
                console.error("Closing connection");
                socket.end();
                return;
            }

            db.getConnection(function(error,connection){
                if(error){
                    console.error("Error connecting to database: " + error);

                    // notify the requestor of our database troubles
                    writeToSocket(socket,
                        JSON.stringify({
                            action: 'access_refresh_error',
                            data: 'Database unreachable. Try again soon.'
                        }),
                        false
                    );

                    return;
                }

                var databaseErrorCallback = function(error) {
                    connection.removeListener('error', databaseErrorCallback);
                    connection.release();
                    console.error("Error from database connection: " + error);
                    return;
                };

                connection.on('error', databaseErrorCallback);

                if(config.allowLegacyAccessRequests)
                {
                    connection.query(
                        '(SELECT ' +
                        '    `sdpid`.`sdpid`,  ' +
                        '    `sdpid_service`.`service_id`,  ' +
                        '    `service_gateway`.`protocol`,  ' +
                        '    `service_gateway`.`port`,  ' +
                        '    `sdpid`.`encrypt_key`,  ' +
                        '    `sdpid`.`hmac_key` ' +
                        'FROM `service_gateway` ' +
                        '    JOIN `sdpid_service` ' +
                        '        ON `sdpid_service`.`service_id` = `service_gateway`.`service_id` ' +
                        '    JOIN `sdpid` ' +
                        '        ON `sdpid`.`sdpid` = `sdpid_service`.`sdpid` ' +
                        'WHERE `sdpid`.`valid` = 1 AND `service_gateway`.`gateway_sdpid` = ? )' +
                        'UNION ' +
                        '(SELECT ' +
                        '    `sdpid`.`sdpid`,  ' +
                        '    `group_service`.`service_id`,  ' +
                        '    `service_gateway`.`protocol`,  ' +
                        '    `service_gateway`.`port`,  ' +
                        '    `sdpid`.`encrypt_key`,  ' +
                        '    `sdpid`.`hmac_key` ' +
                        'FROM `service_gateway` ' +
                        '    JOIN `group_service` ' +
                        '        ON `group_service`.`service_id` = `service_gateway`.`service_id` ' +
                        '    JOIN `group` ' +
                        '        ON `group`.`id` = `group_service`.`group_id` ' +
                        '    JOIN `user_group` ' +
                        '        ON `user_group`.`group_id` = `group`.`id` ' +
                        '    JOIN `sdpid` ' +
                        '        ON `sdpid`.`user_id` = `user_group`.`user_id` ' +
                        'WHERE ' +
                        '    `sdpid`.`valid` = 1 AND ' +
                        '    `group`.`valid` = 1 AND ' +
                        '    `service_gateway`.`gateway_sdpid` = ? )' +
                        'ORDER BY `sdpid` ',
                        [memberDetails.sdpid, memberDetails.sdpid],
                        function (error, rows, fields) {
                            connection.removeListener('error', databaseErrorCallback);
                            connection.release();
                            if(error) {
                                console.error("Access data query returned error: " + error);
                                writeToSocket(socket,
                                    JSON.stringify({
                                        action: 'access_refresh_error',
                                        data: 'Database error. Try again soon.'
                                    }),
                                    false
                                );
                                return;
                            }

                            var data = [];
                            var dataIdx = 0;
                            var currentSdpId = 0;
                            for(var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                                var thisRow = rows[rowIdx];
                                dataIdx = data.length - 1;
                                if(thisRow.sdpid != currentSdpId) {
                                    currentSdpId = thisRow.sdpid;
                                    data.push({
                                        sdp_id: thisRow.sdpid,
                                        source: "ANY",
                                        service_list: thisRow.service_id.toString(),
                                        open_ports: thisRow.protocol + "/" +thisRow.port,
                                        spa_encryption_key_base64: thisRow.encrypt_key,
                                        spa_hmac_key_base64: thisRow.hmac_key
                                    });
                                } else {
                                    data[dataIdx].service_list += "," + thisRow.service_id.toString();
                                    data[dataIdx].open_ports += "," + thisRow.protocol + "/" +thisRow.port;
                                }
                            }

                            if(config.debug) {
                                console.log("Access refresh data to send: \n", data, "\n");
                            }

                            dataTransmitTries++;
                            console.log("Sending access_refresh message to SDP ID " +
                                memberDetails.sdpid + ", attempt: " + dataTransmitTries);

                            writeToSocket(socket,
                                JSON.stringify({
                                    action: 'access_refresh',
                                    data
                                }),
                                false
                            );

                        } // END QUERY CALLBACK FUNCTION

                    );  // END QUERY DEFINITION

                } // END IF allowLegacyAccessRequests
                else
                {
                    connection.query(
                        '(SELECT ' +
                        '    `sdpid`.`sdpid`,  ' +
                        '    `sdpid_service`.`service_id`,  ' +
                        '    `sdpid`.`encrypt_key`,  ' +
                        '    `sdpid`.`hmac_key` ' +
                        'FROM `service_gateway` ' +
                        '    JOIN `sdpid_service` ' +
                        '        ON `sdpid_service`.`service_id` = `service_gateway`.`service_id` ' +
                        '    JOIN `sdpid` ' +
                        '        ON `sdpid`.`sdpid` = `sdpid_service`.`sdpid` ' +
                        'WHERE `sdpid`.`valid` = 1 AND `service_gateway`.`gateway_sdpid` = ? )' +
                        'UNION ' +
                        '(SELECT ' +
                        '    `sdpid`.`sdpid`,  ' +
                        '    `group_service`.`service_id`,  ' +
                        '    `sdpid`.`encrypt_key`,  ' +
                        '    `sdpid`.`hmac_key` ' +
                        'FROM `service_gateway` ' +
                        '    JOIN `group_service` ' +
                        '        ON `group_service`.`service_id` = `service_gateway`.`service_id` ' +
                        '    JOIN `group` ' +
                        '        ON `group`.`id` = `group_service`.`group_id` ' +
                        '    JOIN `user_group` ' +
                        '        ON `user_group`.`group_id` = `group`.`id` ' +
                        '    JOIN `sdpid` ' +
                        '        ON `sdpid`.`user_id` = `user_group`.`user_id` ' +
                        'WHERE ' +
                        '    `sdpid`.`valid` = 1 AND ' +
                        '    `group`.`valid` = 1 AND ' +
                        '    `service_gateway`.`gateway_sdpid` = ? )' +
                        'ORDER BY `sdpid` ',
                        [memberDetails.sdpid, memberDetails.sdpid],
                        function (error, rows, fields) {
                            connection.removeListener('error', databaseErrorCallback);
                            connection.release();
                            if(error) {
                                console.error("Access data query returned error: " + error);
                                writeToSocket(socket,
                                    JSON.stringify({
                                        action: 'access_refresh_error',
                                        data: 'Database error. Try again soon.'
                                    }),
                                    false
                                );
                                return;
                            }

                            var data = [];
                            var dataIdx = 0;
                            var currentSdpId = 0;
                            for(var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                                var thisRow = rows[rowIdx];
                                dataIdx = data.length - 1;
                                if(thisRow.sdpid != currentSdpId) {
                                    currentSdpId = thisRow.sdpid;
                                    data.push({
                                        sdp_id: thisRow.sdpid,
                                        source: "ANY",
                                        service_list: thisRow.service_id.toString(),
                                        spa_encryption_key_base64: thisRow.encrypt_key,
                                        spa_hmac_key_base64: thisRow.hmac_key
                                    });
                                } else {
                                    data[dataIdx].service_list += "," + thisRow.service_id.toString();
                                }
                            }

                            if(config.debug) {
                                console.log("Access refresh data to send: \n", data, "\n");
                            }

                            dataTransmitTries++;
                            console.log("Sending access_refresh message to SDP ID " +
                                memberDetails.sdpid + ", attempt: " + dataTransmitTries);

                            writeToSocket(socket,
                                JSON.stringify({
                                    action: 'access_refresh',
                                    data
                                }),
                                false
                            );

                        } // END QUERY CALLBACK FUNCTION

                    );  // END QUERY DEFINITION

                } // END ELSE (i.e. NOT allowLegacyAccessRequests)

            });  // END DATABASE CONNECTION CALLBACK

        }  // END FUNCTION handleAccessRefresh




        function handleAccessUpdate(message) {
          //TODO

        }


        function handleAccessAck()  {
            console.log("Received access data acknowledgement from SDP ID "+memberDetails.sdpid+
                ", data successfully delivered");

            clearStateVars();

        }  // END FUNCTION handleAccessAck


        function handleConnectionUpdate(message) {
            console.log("Received connection update message from SDP ID "+memberDetails.sdpid);

            // convert conn data into nested array for sql query
            var openConns = [];
            var closedConns = [];
            var deleteConns = [];
            var dest = null;
            var natIp = null;
            var natPort = 0;

            if (message['data']) {
                message['data'].forEach(function(element, index, array) {
                    if( !(
                            element.hasOwnProperty('sdp_id') &&
                            element.hasOwnProperty('service_id') &&
                            element.hasOwnProperty('start_timestamp') &&
                            element.hasOwnProperty('end_timestamp') &&
                            element.hasOwnProperty('protocol') &&
                            element.hasOwnProperty('source_ip') &&
                            element.hasOwnProperty('source_port') &&
                            element.hasOwnProperty('destination_ip') &&
                            element.hasOwnProperty('destination_port') &&
                            element.hasOwnProperty('tunnel_id')
                        )) {
                        console.log("Received connection element with missing data. Dropping element.\n");
                        return;
                    }

                    if(element.hasOwnProperty('nat_destination_ip'))
                        natIp = element['nat_destination_ip'];
                    else
                        natIp = '';

                    if(element.hasOwnProperty('nat_destination_port'))
                        natPort = element['nat_destination_port'];
                    else
                        natPort = 0;

                    if(element['end_timestamp'] == 0)
                        openConns.push([  memberDetails.sdpid,
                                        element['sdp_id'],
                                        element['service_id'],
                                        element['start_timestamp'],
                                        element['end_timestamp'],
                                        element['protocol'],
                                        element['source_ip'],
                                        element['source_port'],
                                        element['destination_ip'],
                                        element['destination_port'],
                                        natIp,
                                        natPort,
                                        connectionId,
                                        element['tunnel_id'],
                                    ]);
                    else {
                        closedConns.push([  memberDetails.sdpid,
                                            element['sdp_id'],
                                            element['service_id'],
                                            element['start_timestamp'],
                                            element['end_timestamp'],
                                            element['protocol'],
                                            element['source_ip'],
                                            element['source_port'],
                                            element['destination_ip'],
                                            element['destination_port'],
                                            natIp,
                                            natPort,
                                            element['tunnel_id'],
                                        ]);

                        deleteConns.push([  connectionId,
                                            element['sdp_id'],
                                            element['start_timestamp'],
                                            element['source_port']
                                        ]);
                    }
                });
                storeConnectionsInDatabase(openConns, closedConns, deleteConns);
            }

            openConns = [];
            closedConns = [];
            deleteConns = [];
            dest = null;
            natIp = null;
            natPort = 0;

            if (message['dtm_data']) {
                message['dtm_data'].forEach(function(element, index, array) {
                    if( !(
                            element.hasOwnProperty('sdp_id') &&
                            element.hasOwnProperty('service_id') &&
                            element.hasOwnProperty('start_timestamp') &&
                            element.hasOwnProperty('end_timestamp') &&
                            element.hasOwnProperty('protocol') &&
                            element.hasOwnProperty('source_ip') &&
                            element.hasOwnProperty('source_port') &&
                            element.hasOwnProperty('destination_ip') &&
                            element.hasOwnProperty('destination_port') &&
                            element.hasOwnProperty('tunnel_id')
                        )) {
                        console.log("Received connection element with missing data. Dropping element.\n");
                        return;
                    }

                    if(element.hasOwnProperty('nat_destination_ip'))
                        natIp = element['nat_destination_ip'];
                    else
                        natIp = '';

                    if(element.hasOwnProperty('nat_destination_port'))
                        natPort = element['nat_destination_port'];
                    else
                        natPort = 0;

                    if(element['end_timestamp'] == 0)
                        openConns.push([  memberDetails.sdpid,
                                        element['sdp_id'],
                                        element['service_id'],
                                        element['start_timestamp'],
                                        element['end_timestamp'],
                                        element['protocol'],
                                        element['source_ip'],
                                        element['source_port'],
                                        element['destination_ip'],
                                        element['destination_port'],
                                        natIp,
                                        natPort,
                                        connectionId,
                                        element['tunnel_id'],
                                    ]);
                    else {
                        closedConns.push([  memberDetails.sdpid,
                                            element['sdp_id'],
                                            element['service_id'],
                                            element['start_timestamp'],
                                            element['end_timestamp'],
                                            element['protocol'],
                                            element['source_ip'],
                                            element['source_port'],
                                            element['destination_ip'],
                                            element['destination_port'],
                                            natIp,
                                            natPort,
                                            element['tunnel_id'],
                                        ]);

                        deleteConns.push([  connectionId,
                                            element['sdp_id'],
                                            element['start_timestamp'],
                                            element['source_port']
                                        ]);
                    }
                });
                storeDtmConnectionsInDatabase(openConns, closedConns, deleteConns);
            }

            if(config.debug) {
                console.log("Received connection update message:\n"+
                            "     Gateway SDP ID: %d \n"+
                            "   Connection count: %d \n",
                            "   DTM Connection count: %d \n",
                            memberDetails.sdpid,
                            (message['dtm_data']) ? message['dtm_data'].length:0,
                            (message['data']) ? message['data'].length:0);
            }
            return;
        }



        // whenever a gateway disconnects from the controller for any reason,
        // move it's open connections to the closed table,
        // if the gateway reconnects and conns are actually still open,
        // the gateway will resend the open conns
        function removeOpenConnections(connectionId) {
            // get database connection
            db.getConnection(function(error,connection){
                if(error){
                    databaseConnTries++;

                    console.error("Error connecting to database in preparation " +
                                  "to remove open connections: " + error);

                    // retry soon
                    setTimeout(removeOpenConnections, config.databaseRetryInterval, connectionId);
                    return;
                }

                var databaseErrorCallback = function(error) {
                    connection.removeListener('error', databaseErrorCallback);
                    connection.release();
                    console.error("Error from database connection: " + error);
                    return;
                };

                connection.on('error', databaseErrorCallback);

                // got a connection to the database
                databaseConnTries = 0;

                connection.query(
                    'SELECT * ' +
                    'FROM `open_connection` ' +
                    'WHERE `gateway_controller_connection_id` = ? ',
                    [connectionId],
                    function (error, rows, fields) {
                        connection.removeListener('error', databaseErrorCallback);
                        connection.release();
                        if(error) {
                            console.error("removeOpenConnections query returned error: " + error);
                            return;
                        }

                        if(rows.length == 0) {
                            if(config.debug) console.log("No open connections found that need to be removed.");
                            return;
                        }

                        if(config.debug) console.log("removeOpenConnections query found connections that need removal.");

                        var deleteList = [];
                        var closeList = [];
                        var conn = null;
                        var now = new Date().valueOf() / 1000;
                        for(var idx = 0; idx < rows.length; idx++)
                        {
                            conn = rows[idx];

                            closeList.push(
                            [
                                conn.gateway_sdpid,
                                conn.client_sdpid,
                                conn.service_id,
                                conn.start_timestamp,
                                now,
                                conn.protocol,
                                conn.source_ip,
                                conn.source_port,
                                conn.destination_ip,
                                conn.destination_port,
                                conn.nat_destination_ip,
                                conn.nat_destination_port
                            ]);

                            deleteList.push(
                            [
                                connectionId,
                                conn.client_sdpid,
                                conn.start_timestamp,
                                conn.source_port
                            ]);

                        }

                        storeConnectionsInDatabase(null, closeList, deleteList);


                    }  // END QUERY CALLBACK FUNCTION

                ); // END QUERY CALL

            });  // END db.getConnection

        }  // END FUNCTION removeOpenConnections



        // store connections in database
        function storeDtmConnectionsInDatabase(openConns, closedConns, deleteConns) {
            db.getConnection(function(error,connection){
                if(error){
                    console.error("Error connecting to database to store connections");
                    console.error(error);
                    databaseConnTries++;

                    if(databaseConnTries >= config.databaseMaxRetries) {
                        console.error("Too many database connection failures. Dropping connection data.");
                        databaseConnTries = 0;
                        return;
                    }

                    // retry soon
                    setTimeout(storeDtmConnectionsInDatabase,
                               config.databaseRetryInterval,
                               openConns,
                               closedConns,
                               deleteConns);
                    return;
                }

                // got connection, reset counter
                databaseConnTries = 0;

                var databaseErrorCallback = function(error) {
                    connection.removeListener('error', databaseErrorCallback);
                    connection.release();
                    console.error("Error from database connection: " + error);
                    return;
                };

                connection.on('error', databaseErrorCallback);

                if(openConns != null && openConns.length > 0) {
                    connection.query(
                        'INSERT IGNORE INTO `dtm_open_connection` (`gateway_sdpid`, `client_sdpid`, ' +
                        '`service_id`, `start_timestamp`, `end_timestamp`, `protocol`, ' +
                        '`source_ip`, `source_port`, `destination_ip`, `destination_port`, ' +
                        '`nat_destination_ip`, `nat_destination_port`, `gateway_controller_connection_id`, `tunnel_id`) ' +
                        'VALUES ? ',
                        //'ON DUPLICATE KEY UPDATE ' +
                        //'`end_timestamp` = VALUES(`end_timestamp`)',
                        [openConns],
                        function (error, rows, fields){
                            if (error)
                            {
                                console.error("Failed when writing open connections to database.");
                                console.error(error);
                                return;
                            }

                            console.log("Successfully stored open dtm connection data in the database");
                        }
                    );
                }

                if(closedConns != null && closedConns.length > 0) {
                    connection.query(
                        'INSERT INTO `dtm_closed_connection` (`gateway_sdpid`, `client_sdpid`, ' +
                        '`service_id`, `start_timestamp`, `end_timestamp`, `protocol`, ' +
                        '`source_ip`, `source_port`, `destination_ip`, `destination_port`, ' +
                        '`nat_destination_ip`, `nat_destination_port`, `tunnel_id`) ' +
                        'VALUES ? '+
                        'ON DUPLICATE KEY UPDATE ' +
                        '`end_timestamp` = VALUES(`end_timestamp`)',
                        [closedConns],
                        function (error, rows, fields){
                            if (error)
                            {
                                console.error("Failed when writing dtm closed connections to database.");
                                console.error(error);
                                return;
                            }

                            console.log("Successfully stored dtm closed connection data in the database");
                        }
                    );

                    connection.query(
                        'DELETE FROM `dtm_open_connection` WHERE ' +
                        '(`gateway_controller_connection_id`, `client_sdpid`, `start_timestamp`, `source_port`) ' +
                        'IN (?) ',
                        [deleteConns],
                        function (error, rows, fields){
                            if (error)
                            {
                                console.error("Failed when removing dtm closed connections from dtm_open_connection table.");
                                console.error(error);
                                return;
                            }

                            console.log("Successfully removed closed connections from dtm_open_connection table.");
                        }
                    );
                }

                connection.removeListener('error', databaseErrorCallback);
                connection.release();
            });

        }

        function storeConnectionsInDatabase(openConns, closedConns, deleteConns) {
            db.getConnection(function(error,connection){
                if(error){
                    console.error("Error connecting to database to store connections");
                    console.error(error);
                    databaseConnTries++;

                    if(databaseConnTries >= config.databaseMaxRetries) {
                        console.error("Too many database connection failures. Dropping connection data.");
                        databaseConnTries = 0;
                        return;
                    }

                    // retry soon
                    setTimeout(storeConnectionsInDatabase,
                               config.databaseRetryInterval,
                               openConns,
                               closedConns,
                               deleteConns);
                    return;
                }

                // got connection, reset counter
                databaseConnTries = 0;

                var databaseErrorCallback = function(error) {
                    connection.removeListener('error', databaseErrorCallback);
                    connection.release();
                    console.error("Error from database connection: " + error);
                    return;
                };

                connection.on('error', databaseErrorCallback);

                if(openConns != null && openConns.length > 0) {
                    connection.query(
                        'INSERT IGNORE INTO `open_connection` (`gateway_sdpid`, `client_sdpid`, ' +
                        '`service_id`, `start_timestamp`, `end_timestamp`, `protocol`, ' +
                        '`source_ip`, `source_port`, `destination_ip`, `destination_port`, ' +
                        '`nat_destination_ip`, `nat_destination_port`, `gateway_controller_connection_id`, `tunnel_id`) ' +
                        'VALUES ? ',
                        //'ON DUPLICATE KEY UPDATE ' +
                        //'`end_timestamp` = VALUES(`end_timestamp`)',
                        [openConns],
                        function (error, rows, fields){
                            if (error)
                            {
                                console.error("Failed when writing open connections to database.");
                                console.error(error);
                                return;
                            }

                            console.log("Successfully stored open connection data in the database");
                        }
                    );
                }

                if(closedConns != null && closedConns.length > 0) {
                    connection.query(
                        'INSERT INTO `closed_connection` (`gateway_sdpid`, `client_sdpid`, ' +
                        '`service_id`, `start_timestamp`, `end_timestamp`, `protocol`, ' +
                        '`source_ip`, `source_port`, `destination_ip`, `destination_port`, ' +
                        '`nat_destination_ip`, `nat_destination_port`, `tunnel_id`) ' +
                        'VALUES ? '+
                        'ON DUPLICATE KEY UPDATE ' +
                        '`end_timestamp` = VALUES(`end_timestamp`)',
                        [closedConns],
                        function (error, rows, fields){
                            if (error)
                            {
                                console.error("Failed when writing closed connections to database.");
                                console.error(error);
                                return;
                            }

                            console.log("Successfully stored closed connection data in the database");
                        }
                    );

                    connection.query(
                        'DELETE FROM `open_connection` WHERE ' +
                        '(`gateway_controller_connection_id`, `client_sdpid`, `start_timestamp`, `source_port`) ' +
                        'IN (?) ',
                        [deleteConns],
                        function (error, rows, fields){
                            if (error)
                            {
                                console.error("Failed when removing closed connections from open_connection table.");
                                console.error(error);
                                return;
                            }

                            console.log("Successfully removed closed connections from open_connection table.");
                        }
                    );
                }

                connection.removeListener('error', databaseErrorCallback);
                connection.release();
            });

        }


        // store generated keys in database
        function storeKeysInDatabase() {
            if (newKeys.hasOwnProperty('spa_encryption_key_base64') &&
                newKeys.hasOwnProperty('spa_hmac_key_base64'))
            {
                if(config.debug)
                    console.log("Found the new keys to store in database for SDP ID "+sdpId);

                db.getConnection(function(error,connection){
                    if(error){
                        console.error("Error connecting to database to store new keys for SDP ID "+sdpId);
                        console.error(error);
                        databaseConnTries++;

                        if(databaseConnTries >= config.databaseMaxRetries) {
                            console.error("Too many database connection failures. Dropping key data.");
                            databaseConnTries = 0;
                            return;
                        }

                        // retry soon
                        setTimeout(storeKeysInDatabase, config.databaseRetryInterval);
                        return;
                    }

                    // got connection, reset counter
                    databaseConnTries = 0;

                    var databaseErrorCallback = function(error) {
                        connection.removeListener('error', databaseErrorCallback);
                        connection.release();
                        console.error("Error from database connection: " + error);
                        return;
                    };

                    connection.on('error', databaseErrorCallback);

                    connection.query(
                        'UPDATE `sdpid` SET ' +
                        '`encrypt_key` = ?, `hmac_key` = ?, ' +
                        '`last_cred_update` = ?, `cred_update_due` = ? WHERE `sdpid` = ?',
                        [newKeys.spa_encryption_key_base64,
                         newKeys.spa_hmac_key_base64,
                         newKeys.updated,
                         newKeys.expires,
                         memberDetails.sdpid],
                        function (error, rows, fields){
                            connection.removeListener('error', databaseErrorCallback);
                            connection.release();
                            if (error)
                            {
                                console.error("Failed when writing keys to database for SDP ID "+sdpId);
                                console.error(error);
                                newKeys = null;
                                clearStateVars();
                                return;
                            }

                            console.log("Successfully stored new keys for SDP ID "+sdpId+" in the database");
                            newKeys = null;
                            clearStateVars();
                            notifyGateways();
                        }

                    );

                });

            } else {
                console.error("Did not find keys to store in database for SDP ID "+sdpId);
                clearStateVars();
            }
        }


        // clear all state variables
        function clearStateVars() {
            action = null;
            dataTransmitTries = 0;
            credentialMakerTries = 0;
            badMessagesReceived = 0;
        }


        // deal with receipt of bad messages
        function handleBadMessage(badMessage) {
            badMessagesReceived++;

            console.error("In handleBadMessage, badMessage:\n" +badMessage);

            if (badMessagesReceived < config.maxBadMessages) {

                console.error("Preparing badMessage message...");
                var badMessageMessage = {
                    action: 'bad_message',
                    data: badMessage
                };

                console.error("Message to send:");
                for(var myKey in badMessageMessage) {
                    console.log("key: " + myKey + "   value: " + badMessageMessage[myKey]);
                }
                writeToSocket(socket, JSON.stringify(badMessageMessage), false);

            } else {

                console.error("Received " + badMessagesReceived + " badly formed messages from SDP ID " +
                    sdpId);
                console.error("Closing connection");
                socket.end();
            }
        }

    }).listen(config.serverPort);

    if(config.maxConnections) server.maxConnections = config.maxConnections;

    // Put a friendly message on the terminal of the server.
    console.log("SDP Controller running at port " + config.serverPort);
}  // END function startServer


function writeToSocket(theSocket, theMsg, endTheSocket) {
    if(config.debug)
        console.log("\n\nSENDING MESSAGE:\n"+theMsg+"\n\n");
    var theMsg_buf = Buffer.allocUnsafe(MSG_SIZE_FIELD_LEN + theMsg.length);
    theMsg_buf.writeUInt32BE(theMsg.length, 0);
    theMsg_buf.write(theMsg, MSG_SIZE_FIELD_LEN);
    theSocket.write(theMsg_buf);

    if(endTheSocket) {
        theSocket.end();
    }
}



function cleanOpenConnectionTable() {
    // get database connection
    db.getConnection(function(error,connection){
        if(error){
            console.error("Error connecting to database to clean " +
                          "open_connection table: " + error);

            throw error;
        }

        var databaseErrorCallback = function(error) {
            connection.removeListener('error', databaseErrorCallback);
            connection.release();
            console.error("Error from database connection: " + error);
            throw error;
        };

        connection.on('error', databaseErrorCallback);

        connection.query(
            'SELECT * FROM `open_connection` ',
            function (error, rows, fields) {
                if(error) {
                    console.error("Database query to clean open_connection " +
                                  "table returned error: " + error);
                    connection.removeListener('error', databaseErrorCallback);
                    connection.release();
                    throw error;
                }

                if(rows.length == 0) {
                    connection.removeListener('error', databaseErrorCallback);
                    connection.release();
                    if(config.debug) console.log("No open connections found that need to be removed.");
                    return;
                }

                if(config.debug) console.log("removeOpenConnections query found connections that need removal.");

                var closeList = [];
                var conn = null;
                var now = new Date().valueOf() / 1000;
                for(var idx = 0; idx < rows.length; idx++)
                {
                    conn = rows[idx];

                    closeList.push(
                    [
                        conn.gateway_sdpid,
                        conn.client_sdpid,
                        conn.service_id,
                        conn.start_timestamp,
                        now,
                        conn.protocol,
                        conn.source_ip,
                        conn.source_port,
                        conn.destination_ip,
                        conn.destination_port,
                        conn.nat_destination_ip,
                        conn.nat_destination_port
                    ]);

                }  // END rows FOR LOOP

                connection.query(
                    'INSERT INTO `closed_connection` (`gateway_sdpid`, `client_sdpid`, ' +
                    '`service_id`, `start_timestamp`, `end_timestamp`, `protocol`, ' +
                    '`source_ip`, `source_port`, `destination_ip`, `destination_port`, ' +
                    '`nat_destination_ip`, `nat_destination_port`) ' +
                    'VALUES ? '+
                    'ON DUPLICATE KEY UPDATE ' +
                    '`end_timestamp` = VALUES(`end_timestamp`)',
                    [closeList],
                    function (error, rows, fields){
                        if (error)
                        {
                            console.error("Failed when writing closed connections to database.");
                            console.error(error);
                            connection.removeListener('error', databaseErrorCallback);
                            connection.release();
                            throw error;
                        }

                        console.log("Successfully stored closed connection data in the database");
                    }
                );

                connection.query(
                    'DELETE FROM `open_connection` ',
                    function (error, rows, fields) {
                        if(error) {
                            console.error("Database query to clean open_connection " +
                                          "table returned error: " + error);
                            connection.removeListener('error', databaseErrorCallback);
                            connection.release();
                            throw error;
                        }
                    }
                );

                connection.removeListener('error', databaseErrorCallback);
                connection.release();

            }  // END QUERY CALLBACK FUNCTION

        ); // END QUERY CALL

    });  // END db.getConnection

}  // END FUNCTION cleanOpenConnectionTable



function checkDatabaseForUpdates(currentInterval) {
    // only run this check if a gateway or gateways are connected
    if(connectedGateways.length == 0) {
        setTimeout(checkDatabaseForUpdates, config.databaseMonitorInterval, currentInterval);
        return;
    }

    // get database connection
    db.getConnection(function(error,connection){
        if(error){
            checkDatabaseTries++;
            currentInterval = currentInterval*2;

            console.error("Error connecting to database in preparation " +
                          "to check for database updates: " + error);

            console.error("Number of consecutive database check failures: "
                          +checkDatabaseTries);

            console.error("Doubling database monitoring interval, will retry in "
                          +currentInterval+" milliseconds.");

            // retry soon
            setTimeout(checkDatabaseForUpdates, config.databaseMonitorInterval, currentInterval);
            return;
        }

        var databaseErrorCallback = function(error) {
            connection.removeListener('error', databaseErrorCallback);
            connection.release();
            console.error("Error from database connection: " + error);
            // retry soon
            setTimeout(checkDatabaseForUpdates, config.databaseMonitorInterval, currentInterval);
            return;
        };

        connection.on('error', databaseErrorCallback);

        // got a connection to the database, make sure interval is correct
        currentInterval = config.databaseMonitorInterval;
        checkDatabaseTries = 0;

        connection.query(
            'SELECT ' +
            '    `timestamp`, `table_name` ' +
            'FROM `refresh_trigger` ' +
            'WHERE `timestamp` >= ? ',
            [lastDatabaseCheck],
            function (error, rows, fields) {
                if(error) {
                    console.error("Database monitoring query returned error: " + error);
                    connection.removeListener('error', databaseErrorCallback);
                    connection.release();
                    setTimeout(checkDatabaseForUpdates, config.databaseMonitorInterval, currentInterval);
                    return;
                }

                if(rows.length == 0) {
                    if(config.debug) console.log("No database updates found requiring access data refresh.");
                    //console.log("No database updates found requiring access data refresh.");
                    connection.removeListener('error', databaseErrorCallback);
                    connection.release();
                    setTimeout(checkDatabaseForUpdates, config.databaseMonitorInterval, currentInterval);
                    return;
                }

                // arriving here means a relevant database update occurred
                console.log("checkDatabaseForUpdates query found relevant updates, " +
                            "sending data refresh to all connected gateways.");

                // if any of the database events involved a change to a service
                // the refresh must include a service refresh
                // access refresh must always be done
                var doServiceRefresh = false;

                for(var idx = 0; idx < rows.length; idx++)
                {
                    if(rows[idx].table_name == 'service' ||
                       rows[idx].table_name == 'service_gateway')
                    {
                        doServiceRefresh = true;
                        break;
                    }
                }

                // the other queries require a simple array of only
                // the sdp ids listed in connectedGateways
                var gatewaySdpIdList = [];
                for(var idx = 0; idx < connectedGateways.length; idx++) {
                    gatewaySdpIdList.push(connectedGateways[idx].sdpId);
                }

                if(gatewaySdpIdList.length < 1)
                {
                    console.log("No relevant gateways to notify regarding database update.");
                    return;
                }

                if(doServiceRefresh)
                {
                    // this will call the access refresh function when it's done
                    sendAllGatewaysServiceRefresh(connection, databaseErrorCallback, gatewaySdpIdList);
                }
                else
                {
                    sendAllGatewaysAccessRefresh(connection, databaseErrorCallback, gatewaySdpIdList);
                }

                // Arriving here means the database check was successful
                lastDatabaseCheck = new Date();
                currentInterval = config.databaseMonitorInterval;
                setTimeout(checkDatabaseForUpdates, config.databaseMonitorInterval, currentInterval);

            }  // END QUERY CALLBACK FUNCTION

        ); // END QUERY CALL

    });  // END db.getConnection

}  // END FUNCTION checkDatabaseForUpdates



function sendAllGatewaysServiceRefresh(connection, databaseErrorCallback, gatewaySdpIdList)
{
    connection.query(
        'SELECT ' +
        '    `service_gateway`.`protocol`,  ' +
        '    `service_gateway`.`gateway_sdpid`,  ' +
        '    `service_gateway`.`service_id`,  ' +
        '    `service_gateway`.`port`, ' +
        '    `service_gateway`.`nat_ip`, ' +
        '    `service_gateway`.`nat_port` ' +
        'FROM `service_gateway` ' +
        'WHERE `service_gateway`.`gateway_sdpid` IN (?) ' +
        'ORDER BY gateway_sdpid ',
        [gatewaySdpIdList],
        function (error, rows, fields) {
            if(error) {
                connection.removeListener('error', databaseErrorCallback);
                connection.release();
                console.error("Service data query returned error: " + error);
                return;
            }

            if(rows.length == 0) {
                connection.removeListener('error', databaseErrorCallback);
                connection.release();
                console.log("No relevant gateways to notify regarding service data refresh.");
                return;
            }

            console.log("Sending service refresh to all connected gateways.");

            var data = [];
            var thisRow = rows[0];
            var currentGatewaySdpId = 0;
            var gatewaySocket = null;

            for(var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                thisRow = rows[rowIdx];

                // if we hit a new gateway, start fresh
                if(thisRow.gateway_sdpid != currentGatewaySdpId) {
                    currentGatewaySdpId = thisRow.gateway_sdpid;
                    data = [];

                    // get the right socket
                    gatewaySocket = null;
                    for(var idx = 0; idx < connectedGateways.length; idx++) {
                        if(connectedGateways[idx].sdpId == currentGatewaySdpId) {
                            gatewaySocket = connectedGateways[idx].socket;
                            break;
                        }
                    }

                    if(!gatewaySocket) {
                        console.error("Preparing to send service refresh to gateway with SDP ID " +currentGatewaySdpId+
                                      ", but socket not found.");

                        // skip past all rows with this gateway sdp id
                        while( (rowIdx + 1) < rows.length &&
                               rows[rowIdx + 1].gateway_sdpid == currentGatewaySdpId) {
                            rowIdx++;
                        }
                        continue;
                    }
                }

                if(thisRow.nat_ip != '' && thisRow.nat_port != 0) {
                    data.push({
                        service_id: thisRow.service_id,
                        proto: thisRow.protocol,
                        port: thisRow.port,
                        nat_ip: thisRow.nat_ip,
                        nat_port: thisRow.nat_port,
                    });
                } else {
                    data.push({
                        service_id: thisRow.service_id,
                        proto: thisRow.protocol,
                        port: thisRow.port,
                    });
                }

                // if this is the last data row or the next is a different gateway
                if( (rowIdx + 1) == rows.length ||
                    rows[rowIdx + 1].gateway_sdpid != currentGatewaySdpId ) {

                    // send off this gateway's data
                    if(config.debug) {
                        console.log("Service refresh data to send to "+currentGatewaySdpId+": \n", data);
                    }

                    console.log("Sending service_refresh message to SDP ID " + currentGatewaySdpId);

                    writeToSocket(gatewaySocket,
                        JSON.stringify({
                            action: 'service_refresh',
                            data
                        }),
                        false
                    );

                } // END IF LAST ROW FOR THIS GATE

            } // END QUERY DATA FOR LOOP


            sendAllGatewaysAccessRefresh(connection, databaseErrorCallback, gatewaySdpIdList);


        } // END QUERY CALLBACK FUNCTION

    );  // END QUERY DEFINITION

}  // END FUNCTION sendAllGatewaysServiceRefresh


function sendAllGatewaysAccessRefresh(connection, databaseErrorCallback, gatewaySdpIdList)
{
    if(config.allowLegacyAccessRequests)
    {
        connection.query(
            '(SELECT ' +
            '    `service_gateway`.`gateway_sdpid` as gatewaySdpId, ' +
            '    `service_gateway`.`service_id`, ' +
            '    `service_gateway`.`protocol`, ' +
            '    `service_gateway`.`port`, ' +
            '    `sdpid`.`sdpid` as clientSdpId, ' +
            '    `sdpid`.`encrypt_key`,  ' +
            '    `sdpid`.`hmac_key` ' +
            'FROM `service_gateway` ' +
            '    JOIN `sdpid_service` ' +
            '        ON `sdpid_service`.`service_id` = `service_gateway`.`service_id` ' +
            '    JOIN `sdpid` ' +
            '        ON `sdpid`.`sdpid` = `sdpid_service`.`sdpid` ' +
            'WHERE `sdpid`.`valid` = 1 AND `service_gateway`.`gateway_sdpid` IN (?) )' +
            'UNION ' +
            '(SELECT ' +
            '    `service_gateway`.`gateway_sdpid` as gatewaySdpId, ' +
            '    `group_service`.`service_id`,  ' +
            '    `service_gateway`.`protocol`, ' +
            '    `service_gateway`.`port`, ' +
            '    `sdpid`.`sdpid` as clientSdpId, ' +
            '    `sdpid`.`encrypt_key`,  ' +
            '    `sdpid`.`hmac_key` ' +
            'FROM `service_gateway` ' +
            '    JOIN `group_service` ' +
            '        ON `group_service`.`service_id` = `service_gateway`.`service_id` ' +
            '    JOIN `group` ' +
            '        ON `group`.`id` = `group_service`.`group_id` ' +
            '    JOIN `user_group` ' +
            '        ON `user_group`.`group_id` = `group`.`id` ' +
            '    JOIN `sdpid` ' +
            '        ON `sdpid`.`user_id` = `user_group`.`user_id` ' +
            'WHERE ' +
            '    `sdpid`.`valid` = 1 AND ' +
            '    `group`.`valid` = 1 AND ' +
            '    `service_gateway`.`gateway_sdpid` IN (?) )' +
            'ORDER BY gatewaySdpId, clientSdpId ',
            [gatewaySdpIdList, gatewaySdpIdList],
            function (error, rows, fields) {
                connection.removeListener('error', databaseErrorCallback);
                connection.release();
                if(error) {
                    console.error("Access data refresh query returned error: " + error);
                    return;
                }

                if(rows.length == 0) {
                    console.log("No relevant gateways to notify regarding access data refresh.");
                    return;
                }

                console.log("Sending access refresh to all connected gateways.");

                var data = [];
                var dataIdx = 0;
                var thisRow = rows[0];
                var currentGatewaySdpId = 0;
                var currentClientSdpId = 0;
                var gatewaySocket = null;

                for(var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                    thisRow = rows[rowIdx];

                    // if we hit a new gateway, start fresh
                    if(thisRow.gatewaySdpId != currentGatewaySdpId) {
                        currentGatewaySdpId = thisRow.gatewaySdpId;
                        data = [];
                        currentClientSdpId = 0;

                        // get the right socket
                        gatewaySocket = null;
                        for(var idx = 0; idx < connectedGateways.length; idx++) {
                            if(connectedGateways[idx].sdpId == currentGatewaySdpId) {
                                gatewaySocket = connectedGateways[idx].socket;
                                break;
                            }
                        }

                        if(!gatewaySocket) {
                            console.error("Preparing to send access refresh to gateway with SDP ID " +currentGatewaySdpId+
                                          ", but socket not found.");

                            // skip past all rows with this gateway sdp id
                            while( (rowIdx + 1) < rows.length &&
                                   rows[rowIdx + 1].gatewaySdpId == currentGatewaySdpId) {
                                rowIdx++;
                            }
                            continue;
                        }
                    }

                    if(thisRow.clientSdpId != currentClientSdpId) {
                        currentClientSdpId = thisRow.clientSdpId;
                        data.push({
                            sdp_id: thisRow.clientSdpId,
                            source: "ANY",
                            service_list: thisRow.service_id.toString(),
                            open_ports: thisRow.protocol + "/" + thisRow.port,
                            spa_encryption_key_base64: thisRow.encrypt_key,
                            spa_hmac_key_base64: thisRow.hmac_key
                        });
                    } else {
                        data[dataIdx].service_list += ", " + thisRow.service_id.toString();
                        data[dataIdx].open_ports += ", " + thisRow.protocol + "/" + thisRow.port;
                    }

                    dataIdx = data.length - 1;

                    // if this is the last data row or the next is a different gateway
                    if( (rowIdx + 1) == rows.length ||
                        rows[rowIdx + 1].gatewaySdpId != currentGatewaySdpId ) {

                        // send off this gateway's data
                        if(config.debug) {
                            console.log("Access refresh data to send to "+currentGatewaySdpId+": \n", data);
                        }

                        console.log("Sending access_refresh message to SDP ID " + currentGatewaySdpId);

                        writeToSocket(gatewaySocket,
                            JSON.stringify({
                                action: 'access_refresh',
                                data
                            }),
                            false
                        );

                    } // END IF LAST ROW FOR THIS GATE

                } // END QUERY DATA FOR LOOP



            } // END QUERY CALLBACK FUNCTION

        );  // END QUERY DEFINITION

    }  // END IF allowLegacyAccessRequests
    else
    {
        connection.query(
            '(SELECT ' +
            '    `service_gateway`.`gateway_sdpid` as gatewaySdpId, ' +
            '    `service_gateway`.`service_id`, ' +
            '    `sdpid`.`sdpid` as clientSdpId, ' +
            '    `sdpid`.`encrypt_key`,  ' +
            '    `sdpid`.`hmac_key` ' +
            'FROM `service_gateway` ' +
            '    JOIN `sdpid_service` ' +
            '        ON `sdpid_service`.`service_id` = `service_gateway`.`service_id` ' +
            '    JOIN `sdpid` ' +
            '        ON `sdpid`.`sdpid` = `sdpid_service`.`sdpid` ' +
            'WHERE `sdpid`.`valid` = 1 AND `service_gateway`.`gateway_sdpid` IN (?) )' +
            'UNION ' +
            '(SELECT ' +
            '    `service_gateway`.`gateway_sdpid` as gatewaySdpId, ' +
            '    `group_service`.`service_id`,  ' +
            '    `sdpid`.`sdpid` as clientSdpId, ' +
            '    `sdpid`.`encrypt_key`,  ' +
            '    `sdpid`.`hmac_key` ' +
            'FROM `service_gateway` ' +
            '    JOIN `group_service` ' +
            '        ON `group_service`.`service_id` = `service_gateway`.`service_id` ' +
            '    JOIN `group` ' +
            '        ON `group`.`id` = `group_service`.`group_id` ' +
            '    JOIN `user_group` ' +
            '        ON `user_group`.`group_id` = `group`.`id` ' +
            '    JOIN `sdpid` ' +
            '        ON `sdpid`.`user_id` = `user_group`.`user_id` ' +
            'WHERE ' +
            '    `sdpid`.`valid` = 1 AND ' +
            '    `group`.`valid` = 1 AND ' +
            '    `service_gateway`.`gateway_sdpid` IN (?) )' +
            'ORDER BY gatewaySdpId, clientSdpId ',
            [gatewaySdpIdList, gatewaySdpIdList],
            function (error, rows, fields) {
                connection.removeListener('error', databaseErrorCallback);
                connection.release();
                if(error) {
                    console.error("Access data refresh query returned error: " + error);
                    return;
                }

                if(rows.length == 0) {
                    console.log("No relevant gateways to notify regarding access data refresh.");
                    return;
                }

                console.log("Sending access refresh to all connected gateways.");

                var data = [];
                var dataIdx = 0;
                var thisRow = rows[0];
                var currentGatewaySdpId = 0;
                var currentClientSdpId = 0;
                var gatewaySocket = null;

                for(var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                    thisRow = rows[rowIdx];

                    // if we hit a new gateway, start fresh
                    if(thisRow.gatewaySdpId != currentGatewaySdpId) {
                        currentGatewaySdpId = thisRow.gatewaySdpId;
                        data = [];
                        currentClientSdpId = 0;

                        // get the right socket
                        gatewaySocket = null;
                        for(var idx = 0; idx < connectedGateways.length; idx++) {
                            if(connectedGateways[idx].sdpId == currentGatewaySdpId) {
                                gatewaySocket = connectedGateways[idx].socket;
                                break;
                            }
                        }

                        if(!gatewaySocket) {
                            console.error("Preparing to send access refresh to gateway with SDP ID " +currentGatewaySdpId+
                                          ", but socket not found.");

                            // skip past all rows with this gateway sdp id
                            while( (rowIdx + 1) < rows.length &&
                                   rows[rowIdx + 1].gatewaySdpId == currentGatewaySdpId) {
                                rowIdx++;
                            }
                            continue;
                        }
                    }

                    if(thisRow.clientSdpId != currentClientSdpId) {
                        currentClientSdpId = thisRow.clientSdpId;
                        data.push({
                            sdp_id: thisRow.clientSdpId,
                            source: "ANY",
                            service_list: thisRow.service_id.toString(),
                            spa_encryption_key_base64: thisRow.encrypt_key,
                            spa_hmac_key_base64: thisRow.hmac_key
                        });
                    } else {
                        data[dataIdx].service_list += ", " + thisRow.service_id.toString();
                    }

                    dataIdx = data.length - 1;

                    // if this is the last data row or the next is a different gateway
                    if( (rowIdx + 1) == rows.length ||
                        rows[rowIdx + 1].gatewaySdpId != currentGatewaySdpId ) {

                        // send off this gateway's data
                        if(config.debug) {
                            console.log("Access refresh data to send to "+currentGatewaySdpId+": \n", data);
                        }

                        console.log("Sending access_refresh message to SDP ID " + currentGatewaySdpId);

                        writeToSocket(gatewaySocket,
                            JSON.stringify({
                                action: 'access_refresh',
                                data
                            }),
                            false
                        );

                    } // END IF LAST ROW FOR THIS GATE

                } // END QUERY DATA FOR LOOP

            } // END QUERY CALLBACK FUNCTION

        );  // END QUERY DEFINITION

    }  // END ELSE (i.e. NOT allowLegacyAccessRequests)

}  // END FUNCTION sendAllGatewaysAccessRefresh



function sdpQueryException(sdpId, entries) {
    this.name = "SdpQueryException";
    this.message = "SDP ID " + sdpId + " query returned " + entries + " entries";
}

function sdpConfigException(configName, correctiveMessage) {
    this.name = "SdpConfigException";
    this.message = "Invalid entry for " + configName + "\n" + correctiveMessage;
}


