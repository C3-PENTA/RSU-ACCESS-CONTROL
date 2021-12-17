package storage

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"

	"github.com/amolabs/amo-client-go/lib/keys"
)

type UploadBody struct {
	Owner    string          `json:"owner"`
	Metadata json.RawMessage `json:"metadata"`
	Data     string          `json:"data"`
}

// TODO: derive owner from pubKey
func doUpload(owner string, data, token, pubKey, sig []byte) ([]byte, error) {
	uploadBody := UploadBody{
		Owner:    owner,
		Metadata: []byte(`{"owner":"` + owner + `"}`),
		Data:     hex.EncodeToString(data),
	}
	reqJson, err := json.Marshal(uploadBody)
	if err != nil {
		return nil, err
	}

	client := &http.Client{}
	req, err := http.NewRequest(
		"POST",
		Endpoint+"/api/v1/parcels",
		bytes.NewBuffer(reqJson),
	)
	if err != nil {
		return nil, err
	}
	req.Header.Add("Content-Type", "application/json")
	req.Header.Add("X-Auth-Token", string(token))
	req.Header.Add("X-Public-Key", hex.EncodeToString(pubKey))
	req.Header.Add("X-Signature", hex.EncodeToString(sig))

	ret, err := doHTTP(client, req)
	return ret, err
}

func Upload(data []byte, key keys.KeyEntry) ([]byte, error) {
	bytes := sha256.Sum256(data)
	hash := hex.EncodeToString(bytes[:])
	op, err := getOp("upload", hash)
	if err != nil {
		return nil, err
	}
	authToken, err := requestToken(key.Address, op)
	if err != nil {
		return nil, err
	}
	sig, err := signToken(key, authToken)

	return doUpload(key.Address, data, authToken, key.PubKey, sig)
}
