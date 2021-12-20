package rpc

func QueryAppVersion() ([]byte, error) {
	ret, err := ABCIQuery("/version", nil)
	return ret, err
}

func QueryAppConfig() ([]byte, error) {
	ret, err := ABCIQuery("/config", nil)
	return ret, err
}