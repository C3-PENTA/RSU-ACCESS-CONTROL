package storage

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/amolabs/amo-client-go/lib/keys"
)

const (
	testToken = `testtoken`
	testBody  = "test parcel content"
	testId    = "eeee"
	testMeta  = `{"owner":"2f2f"}`
)

func testHandleAuth(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		w.WriteHeader(405)
		w.Write([]byte(`{"error":"Expected POST method"}`))
		return
	}
	body, err := ioutil.ReadAll(req.Body)
	if err != nil {
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"empty request body"}`))
		return
	}

	// same as AuthBody but, change each field as a pointer
	var authBody struct {
		User      *string          `json:"user"`
		Operation *json.RawMessage `json:"operation"`
	}
	err = json.Unmarshal(body, &authBody)
	if err != nil || authBody.User == nil || authBody.Operation == nil {
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"malformed request body"}`))
		return
	}
	var opReq struct {
	}
	err = json.Unmarshal(*authBody.Operation, &opReq)
	if err != nil {
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"malformed request body"}`))
		return
	}

	res := struct {
		Token string `json:"token"`
	}{testToken}
	fmt.Println("res", res)
	rsp, err := json.Marshal(res)
	fmt.Println("rsp", string(rsp))
	if err != nil {
		w.WriteHeader(500)
		w.Write([]byte(`{"error":"internal error: unable to marshal json"}`))
	}
	w.Write(rsp)
}

func testHandleUpload(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		w.WriteHeader(405)
		w.Write([]byte(`{"error":"Expected POST method"}`))
		return
	}
	body, err := ioutil.ReadAll(req.Body)
	if err != nil {
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"empty request body"}`))
		return
	}

	// same as AuthBody but, change each field as a pointer
	var uploadBody struct {
		Owner    *string          `json:"owner"`
		Metadata *json.RawMessage `json:"metadata"`
		Data     *string          `json:"data"`
	}
	err = json.Unmarshal(body, &uploadBody)
	if err != nil || uploadBody.Owner == nil || uploadBody.Metadata == nil || uploadBody.Data == nil {
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"malformed request body"}`))
		return
	}

	stoRes := struct {
		Id string `json:"id"`
	}{testId}
	res, _ := json.Marshal(stoRes)
	w.Write(res)
}