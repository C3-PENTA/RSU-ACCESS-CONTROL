package rpc

func QueryAppVersion() ([]byte, error) {
	ret, err := ABCIQuery("/version", nil)
	return ret, err
}

func QueryAppConfig() ([]byte, error) {
	ret, err := ABCIQuery("/config", nil)
	return ret, err
}

func QueryBalance(udc uint32, address string) ([]byte, error) {
	queryPath := "/balance"
	if udc != 0 {
		queryPath = fmt.Sprintf("%s/%d", queryPath, udc)
	}
	address = toUpper(address)
	ret, err := ABCIQuery(queryPath, address)
	if ret == nil {
		ret = []byte("0")
	}
	return ret, err
}
