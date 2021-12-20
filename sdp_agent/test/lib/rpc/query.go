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

func QueryDraft(draftID string) ([]byte, error) {
	draftIDUint32, err := types.ConvIDFromStr(draftID)
	if err != nil {
		return nil, err
	}
	return ABCIQuery("/draft", draftIDUint32)
}

func QueryVote(draftID, address string) ([]byte, error) {
	draftIDUint32, err := types.ConvIDFromStr(draftID)
	if err != nil {
		return nil, err
	}
	address = toUpper(address)
	return ABCIQuery("/vote", struct {
		DraftID uint32 `json:"draft_id"`
		Voter   string `json:"voter"`
	}{draftIDUint32, address})
}

func QueryStorage(storageID string) ([]byte, error) {
	storageIDUint32, err := types.ConvIDFromStr(storageID)
	if err != nil {
		return nil, err
	}
	return ABCIQuery("/Storage", storageIDUint32)
}

func QueryParcel(parcelID string) ([]byte, error) {
	parcelID = toUpper(parcelID)
	return ABCIQuery("/parcel", parcelID)
}

func QueryRequest(target, recipient string) ([]byte, error) {
	target = toUpper(target)
	recipient = toUpper(recipient)
	return ABCIQuery("/request", struct {
		Target    string `json:"target"`
		Recipient string `json:"recipient"`
	}{target, recipient})
}