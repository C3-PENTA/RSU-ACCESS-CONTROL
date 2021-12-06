module.exports = {
	'debug': true,
	// choose one of client|gateway|both
	'mode': 'gateway',
	'clientCert': '/home/pi/SDP-Agent/gateway-cert.pem',
	'clientKey':  '/home/pi/SDP-Agent/gateway-key.pem',
	'controllerIp': '52.231.200.89',
	'controllerPort': 5000,
	'allowIp': '192.168.23.99',
	'fwknopClientConfig': './fwknop-client-config',
	'DTMClientConfig': '/home/pi/code/sdp_dtm/clientconf.json',
	'DTMClientBin': '/home/pi/code/sdp_dtm/build/sdpdtm/sdpdtm',
	'fwknopServerConfig': '/etc/fwknop/access.d/fwknop-server.conf',
	'DTMServerConfig': '/home/pi/code/sdp_dtm/serverconf.json',
	'DTMServerBin': '/home/pi/code/sdp_dtm/build/sdpdtm/sdpdtm',
	'dtmConnInfoDir': '/home/pi/SDP-Agent/dtm-connection/',
	'fwAccessTimeout': ''
};
