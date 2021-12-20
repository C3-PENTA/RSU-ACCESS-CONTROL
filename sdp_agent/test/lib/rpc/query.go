package rpc

func QueryAppVersion() ([]byte, error) {
	ret, err := ABCIQuery("/version", nil)
	return ret, err
}