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

func QueryUDC(udcID string) ([]byte, error) {
	udcIDUint32, err := types.ConvIDFromStr(udcID)
	if err != nil {
		return nil, err
	}
	return ABCIQuery("/udc", udcIDUint32)
}

func QueryUDCLock(udcID, address string) ([]byte, error) {
	address = toUpper(address)
	return ABCIQuery("/udclock/"+udcID, address)
}

func QueryStake(address string) ([]byte, error) {
	address = toUpper(address)
	return ABCIQuery("/stake", address)
}

func QueryDelegate(address string) ([]byte, error) {
	address = toUpper(address)
	return ABCIQuery("/delegate", address)
}