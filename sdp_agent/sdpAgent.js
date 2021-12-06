const tls = require('tls');
const fs = require('fs');

/**
 * 명령행 인자를 받는 부분
 * @argv[2]: configuration file 위치(경로/파일명)
 *
 * 명령행 인자를 받을 수 있고 만약 없다면 현재 디렉토리에서 .config 파일을
 * config 파일로 설정한다.
 */
if (process.argv.length > 2) {
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

/**
 * 전역 상수를 define 한다.
 * JSON 타입 상수들은 SDP Controller 주고받는 command msg 이다.
 */
const keepAliveMessage = { action: 'keep_alive' };
const clientSpainfoRequest = { action: 'client_spainfo_request' };
const clientSpainfoAck = { action: 'spainfo_ack' };
const accessRefreshRequest = { action: 'access_refresh_request' };
const accessAck = { action: 'access_ack' };
/**
 * SDP Controller 와 주고받는 Msg 사이즈를 정의한다.
 */
const MSG_SIZE_FIELD_LEN = 4;
/**
 * DTM 의 연결정보를 저장한 디렉토리를 설정한다.
 */
const dtmDirPath = config.dtmConnInfoDir;

function checkControllerConnection(socket)
{
  if (config.debug)
  {
    console.log('check controller connection informatioin');
  }
  writeToSocket(socket, JSON.stringify(keepAliveMessage), false);
  setTimeout(checkControllerConnection, 30000, socket);
}

function checkDTMConnection(socket)
{
  if (config.debug)
  {
    console.log('check dtm connection informatioin');
  }
  fs.readdir(dtmDirPath, (err, files) => {
    if (files.length >= 2) {
      var currNumFile = 0;
      currNumFile = files.length;
      for (var i = 0; i < files.length; i++) {
        var dtmConnFile = require(dtmDirPath + files[i]);
        if (!dtmConnFile['data'] && !dtmConnFile['dtm_data']) {
          fs.unlinkSync(dtmDirPath + files[i]);
          continue;
        }
        writeToSocket(socket, JSON.stringify(dtmConnFile), false);
        fs.unlinkSync(dtmDirPath + files[i]);
        if (--currNumFile < 2) {
          break;
        }
      }
    }
  });
  setTimeout(checkDTMConnection, 1000, socket);
}

/**
 * TLS Connection option 을 설정한다.
 * @host: SDP Controller IP 를 설정한다.
 * @key: SDP Controller 로 부터 발급된 SDP Agent 개인키
 * @cert: SDP Controller 로 부터 발급된 SDP Agent 인증서
 * @rejectUnauthorized: 서버 인증 진행여부를 설정한다.
 *  SDP Controller TLS 인증서가 self signed 인증서일 경우 연결 실패가 되어 값을 false 로 설정함.
 */
const options = {
  host: config.controllerIp,
  key: fs.readFileSync(config.clientKey),
  cert: fs.readFileSync(config.clientCert),
  rejectUnauthorized: false,
};

/**
 * SDP Controller 와 TLS 연결을 맺는다.
 * @port: SDP Controller 의 TLS 포트 번호
 * @options: TLS 설정
 */
const socket = tls.connect(config.controllerPort, options, () => {
  if (config.debug)
  {
    console.log('client connected',
      socket.authorized ? 'authorized' : 'unauthorized');
  }
  var action = null;
  var expectedMessageSize = 0;
  var totalSizeBytesReceived = 0;
  var sizeBytesNeeded = 0;
  var dataBytesToRead = 0;
  var totalMessageBytesReceived = 0;
  var sizeBuffer = Buffer.allocUnsafe(MSG_SIZE_FIELD_LEN);
  var messageBuffer = Buffer.allocUnsafe(0);

  if (config.mode == "client") {
    // 현재버전은 mode 가 cilent 일 경우만 spa 정보를 얻는다.
    // gateway 도 spa 정보가 피요한 경우 추가 개발이 필요하다.
    writeToSocket(socket, JSON.stringify(clientSpainfoRequest), false);
  }
  else {
    writeToSocket(socket, JSON.stringify(accessRefreshRequest), false);
    setTimeout(checkDTMConnection, 1000, socket);
    setTimeout(checkControllerConnection, 30000, socket);
  }
  socket.on('data', function(data) {
    if (config.debug)
    {
      console.log(data);
    }
    while (data.length) {
      // have we set the full message size variable yet
      if (expectedMessageSize == 0) {
        sizeBytesNeeded = MSG_SIZE_FIELD_LEN - totalSizeBytesReceived;

        // exceptional case, so few bytes arrived
        // not enough data to read expected message size
        if (data.length < sizeBytesNeeded) {
          data.copy(sizeBuffer, totalSizeBytesReceived, 0, data.length);
          totalSizeBytesReceived += data.length;
          data = Buffer.allocUnsafe(0);
          return;
        }

        data.copy(sizeBuffer, totalSizeBytesReceived, 0, sizeBytesNeeded);
        totalSizeBytesReceived = MSG_SIZE_FIELD_LEN;
        expectedMessageSize = sizeBuffer.readUInt32BE(0);

        // time to reset the buffer
        messageBuffer = Buffer.allocUnsafe(0);
      }

      // if there's more data in the received buffer besides the message size field (i.e. actual message contents)
      if (data.length > sizeBytesNeeded) {

        // if there are fewer bytes than what's needed to complete the message
        if ((data.length - sizeBytesNeeded) < (expectedMessageSize - totalMessageBytesReceived)) {
          // then read from after the size field to end of the received buffer
          dataBytesToRead = data.length - sizeBytesNeeded;
        }
        else {
          dataBytesToRead = expectedMessageSize - totalMessageBytesReceived;
        }

        totalMessageBytesReceived += dataBytesToRead;
        messageBuffer = Buffer.concat([messageBuffer,
          data.slice(sizeBytesNeeded, sizeBytesNeeded + dataBytesToRead)],
          totalMessageBytesReceived);
      }

      // if the message is now complete, process
      if (totalMessageBytesReceived == expectedMessageSize) {
        expectedMessageSize = 0;
        totalSizeBytesReceived = 0;
        totalMessageBytesReceived = 0;
        processMessage(messageBuffer);
      }

      data = data.slice(sizeBytesNeeded + dataBytesToRead);
      sizeBytesNeeded = 0;
      dataBytesToRead = 0;

    }
  });

  // Parse SDP messages
  function processMessage(data) {
    if (config.debug) {
      console.log("Message Data Received: ");
      console.log(data.toString());
    }
    try {
      var message = JSON.parse(data);
    }
    catch (err) {
      console.error("Error processing the following received data: \n" + data.toString());
      console.error("JSON parse failed with error: " + err);
      return;
    }

    if (config.debug) {
      console.log("Message parsed");
      console.log("JSON-Parsed Message Data Received: ");
      for (var myKey in message) {
        console.log("key: " + myKey + "   value: " + message[myKey]);
      }
    }

    action = message['action'];
    if (action === 'client_spainfo') {
      handleClientSpainfoResponse(message);
    } else if (action === 'spainfo_ack') {
      handleSpainfoAck();
    } else if (action === 'access_refresh') {
      handleAccessRefreshResponse(message);
    } else if (action === 'credentials_good') {
      // doing nothing with these yet
      return;
    } else if (action === 'keep_alive') {
      if (config.debug) {
        console.log("recv keep_alive")
      }
      return;
    } else if (action === 'bad_message') {
      // doing nothing with these yet
      return;
    } else {
      console.error("Invalid message received, invalid or missing action");
    }
  }
  function handleAccessRefreshResponse(message) {
    message['data'].forEach( (element, index, array) => {
      if ( !(
              element.hasOwnProperty('sdp_id') &&
              element.hasOwnProperty('source') &&
              element.hasOwnProperty('service_list') &&
              element.hasOwnProperty('open_ports') &&
              element.hasOwnProperty('spa_encryption_key_base64') &&
              element.hasOwnProperty('spa_hmac_key_base64')
      )) {
        console.log("Received connection element with missing data. Dropping element.\n");
        return;
      }
      if (config.debug)
      {
        console.log(
          " sdp_id " + element['sdp_id'] + "\n" +
          " source " + element['source'] + "\n" +
          " service_list " + element['service_list'] + "\n" +
          " open_ports " + element['open_ports'] + "\n" +
          " spa_encryption_key_base64 " + element['spa_encryption_key_base64'] + "\n" +
          " spa_hmac_key_base64 " + element['spa_hmac_key_base64']
        );
      }
      let contentsFwknopServer = 'SOURCE\t' + element['source'] + '\n' +
        'REQUIRE_SOURCE_ADDRESS\tY\n' +
        'REQUIRE_USERNAME\t' + element['sdp_id'] + '\n' +
        'KEY_BASE64\t' + element['spa_encryption_key_base64'] + '\n' +
        'HMAC_KEY_BASE64\t' + element['spa_hmac_key_base64'] + '\n';
      if (!index) {
        fs.writeFile(config.fwknopServerConfig, contentsFwknopServer, (err) => {
          if (err) throw err;
          console.log('fwknop server config saved!');
          fs.chmod(config.fwknopServerConfig, 0600, (err) => {
              console.log('Changed file permissions')
          })
        });
      }
      else {
        fs.appendFile(config.fwknopServerConfig, contentsFwknopServer, (err) => {
        if (err) throw err;
        console.log('fwknop server config saved!');
        });
      }

      /*
       * 아래 로직은 Gateway Agent 가 DTM Server config 를 생성하고 DTM 을 실행 시킨다.
       * 현재 포인트는 controller 로 부터 여러 SDP Client 의 service 정보들을 받는 위치이다.
       * 그러나 현재 구조에서 여러 client 로 부터 정보를 받는 다면 DTM config 구현이 완전하지 않아
       * 추가적인 DTM config 구성을 수행할 수 없다.
       * 나중에 DTM이 고도화 될 때 추가적인 기능을 개발해야 한다.
       */
      if (!index && config.mode == 'gateway') {
        fs.readFile(config.DTMServerConfig, (err, data) => {
          if (err) { throw err; }
          var content = JSON.parse(data);
          var dtmServerProperty = content['DtmServer'];
          var serviceArray = content['service'];
          var serviceListArray = element['service_list'].split(',');
          var openPortArray = element['open_ports'].split(',');

          // 제일 첫 번째 open 포트를 할당한다.
          // 두 번째 이상은 현재 구조의 한계로 나중에 구조개선 필요
          dtmServerProperty['port'] = parseInt(openPortArray[0].split('/')[1], 10);
          dtmServerProperty['cert_file'] = config.clientCert;
          dtmServerProperty['key_file'] = config.clientKey;
          dtmServerProperty['info_dir'] = config.dtmConnInfoDir;
          for (var i = 0; i < serviceArray.length; i++) {
            if (serviceListArray.length <= i) {
              // service id 등록된 개수가 config 개수를 넘어서면 마지막 서비스 id 로 다 채움
              // DB 와 config 의 sync 가 맞지 않는 상태 임. 구조개선 필요
              serviceArray[i]['service_id'] = parseInt(serviceListArray[serviceListArray.length - 1], 10);
		continue;
            }
            serviceArray[i]['service_id'] = parseInt(serviceListArray[i], 10);
          }
          // config 파일 갱신
          fs.writeFileSync(config.DTMServerConfig + '.tmp', JSON.stringify(content, null, 4));
          fs.createReadStream(config.DTMServerConfig).pipe(fs.createWriteStream(config.DTMServerConfig + '.bak'));
          fs.rename(config.DTMServerConfig + '.tmp', config.DTMServerConfig, (err) => {
            if (err) console.log('ERROR: ' + err);
          });
        });
        // DTM 을 실행한다.
        var spawn = require('child_process').spawn;
        spawn(config.DTMServerBin,
          ['-c', config.DTMServerConfig, '&'], {
            stdio: 'ignore',
            detached: true
          }).unref();
      }
    });
    writeToSocket(socket, JSON.stringify(accessAck), false);
  }

  function handleClientSpainfoResponse(message) {
    message['data'].forEach( (element, index, array) => {
      if ( !(
              element.hasOwnProperty('sdp_id') &&
              element.hasOwnProperty('source') &&
              element.hasOwnProperty('encrypt_key') &&
              element.hasOwnProperty('hmac_key') &&
              element.hasOwnProperty('open_ports') &&
              element.hasOwnProperty('gw_addr')
      )) {
        console.log("Received connection element with missing data. Dropping element.\n");
        return;
      }
      if (config.debug)
      {
        console.log(
          " sdp_id " + element['sdp_id'] + "\n" +
          " service_list " + element['service_list'] + "\n" +
          " source " + element['source'] + "\n" +
          " encrypt_key " + element['encrypt_key'] + "\n" +
          " hmac_key " + element['hmac_key'] + "\n" +
          " open_ports " + element['open_ports'] + "\n" +
          " gw_addr " + element['gw_addr']
        );
      }
      let contentsFwknopClient = '[' + element['gw_addr'] + ']\n' +
        'ALLOW_IP\t' + config.allowIp + '\n' +
        'ACCESS\t' + element['open_ports'] + '\n' +
        'SPA_SERVER\t' + element['gw_addr'] + '\n' +
        'SPOOF_USER\t' + element['sdp_id'] + '\n' +
        'KEY_BASE64\t' + element['encrypt_key'] + '\n' +
        'HMAC_KEY_BASE64\t' + element['hmac_key'] + '\n' +
        'USE_HMAC\tY\n';

      fs.writeFile(config.fwknopClientConfig, contentsFwknopClient, (err) => {
        if (err) throw err;
        console.log('fwknop clientrc saved!');
        fs.chmod(config.fwknopClientConfig, 0600, (err) => {
            console.log('Changed file permissions')
        })
        // controller 로 SPA 정보를 잘 받고 적용했음을 알린다.
        writeToSocket(socket, JSON.stringify(clientSpainfoAck), false);
        // fwknop client 프로그램을 이용하여 SPA 인증을 받는다.
        // TODO
        // SPA 이 실패할 경우 재인증 요청 기능 추가 필요
        var child_process = require('child_process');
        child_process.execFile('/usr/bin/fwknop',
          ['--rc-file', config.fwknopClientConfig, '-n', element['gw_addr']],
          (error, stdout, stderr) => {
          if (error) { throw error; }
          console.log(stdout)
        });
      });
      // DTM 실행 전 controller 로 받은 정보를 config 에 반영한다.
      // WARNNING
      // 수신한 data array 가 2개이상이면 DTM Config 를 Array 의 마지막 값으로 적용된다.
      // 현재는 1 client 가 2개 이상의 GW 를 지원할 수 없기 때문이다.
      if (config.mode == 'client') {
        fs.readFile(config.DTMClientConfig, (err, data) => {
          if (err) { throw err; }
          var content = JSON.parse(data);
          var dtmClientProperty = content['DtmClient'];
          var serviceArray = content['service'];
          var serviceListArray = element['service_list'].split(',');
          var openPortArray = element['open_ports'].split(',');

          dtmClientProperty['sdp_id'] = parseInt(element['sdp_id'], 10);
          dtmClientProperty['dtmserver_addr'] = element['gw_addr'];
          // 제일 첫 번째 open 포트를 할당한다.
          // 두 번째 이상은 현재 구조의 한계로 나중에 구조개선 필요
          dtmClientProperty['dtmserver_port'] = parseInt(openPortArray[0].split('/')[1], 10);
          for (var i = 0; i < serviceArray.length; i++) {
            if (serviceListArray.length <= i) {
              // service id 등록된 개수가 config 개수를 넘어서면 마지막 서비스 id 로 다 채움
              // DB 와 config 의 sync 가 맞지 않는 상태 임. 구조개선 필요
              serviceArray[i]['service_id'] = parseInt(serviceListArray[serviceListArray.length-1], 10);
		    continue;
            }
            serviceArray[i]['service_id'] = parseInt(serviceListArray[i], 10);
          }
          // config 파일 갱신
          fs.writeFileSync(config.DTMClientConfig + '.tmp', JSON.stringify(content, null, 4));
          fs.createReadStream(config.DTMClientConfig).pipe(fs.createWriteStream(config.DTMClientConfig + '.bak'));
          fs.rename(config.DTMClientConfig + '.tmp', config.DTMClientConfig, (err) => {
            if (err) console.log('ERROR: ' + err);
          });
        });
        // DTM 을 실행한다.
        var spawn = require('child_process').spawn;
        spawn(config.DTMClientBin,
          ['-c', config.DTMClientConfig, '&'], {
            stdio: 'ignore',
            detached: true
          }).unref();
        // 그냥 종료하면 실행결과가 이상해 진다. 1초 쉬다가 종료
        setTimeout((() => {
          return process.exit();
        }), 1000);
      }
    });
  }

  socket.on('error', function (error) {
      console.error(error);
      socket.end();
  });
  socket.on('end', () => {
    socket.close();
  });
});

function writeToSocket(theSocket, theMsg, endTheSocket) {
    console.log("\n\nSENDING MESSAGE:\n"+theMsg+"\n\n");
    var theMsg_buf = Buffer.allocUnsafe(MSG_SIZE_FIELD_LEN + theMsg.length);
    theMsg_buf.writeUInt32BE(theMsg.length, 0);
    theMsg_buf.write(theMsg, MSG_SIZE_FIELD_LEN);
    theSocket.write(theMsg_buf);

    if(endTheSocket) {
        theSocket.end();
    }
}
