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

func testHandleParcel(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" && req.Method != "DELETE" {
		w.WriteHeader(405)
		w.Write([]byte(`{"error":"Expected GET or DELETE method"}`))
		return
	}
	u, err := url.ParseRequestURI(req.RequestURI)
	if err != nil {
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"malformed request URI"}`))
		return
	}
	q := u.Query()
	k := q.Get("key")
	if len(k) > 0 {
		
		switch k {
		case "metadata":
			w.Write([]byte(testMeta))
		default:
			w.WriteHeader(400)
			w.Write([]byte(`{"error":"unknown query key"}`))
		}
		return
	}


	if req.Method == "GET" {
		authToken := req.Header.Get("X-Auth-Token")
		pubKey := req.Header.Get("X-Public-Key")
		sig := req.Header.Get("X-Signature")
		if authToken != testToken {
			w.WriteHeader(401)
			w.Write([]byte(`{"error":"X-Auth-Token header missing"}`))
			return
		}
		if len(pubKey) == 0 {
			w.WriteHeader(401)
			w.Write([]byte(`{"error":"X-Public-Key header missing"}`))
			return
		}
		b, err := hex.DecodeString(pubKey)
		if err != nil || len(b) != 65 {
			w.WriteHeader(400)
			w.Write([]byte(`{"error":"malformed pubKey"}`))
			return
		}
		if len(sig) == 0 {
			w.WriteHeader(401)
			w.Write([]byte(`{"error":"X-Signature header missing"}`))
			return
		}
		b, err = hex.DecodeString(sig)
		if err != nil || len(b) != 64 {
			w.WriteHeader(400)
			w.Write([]byte(`{"error":"malformed signature"}`))
			return
		}

		w.Write([]byte(testBody))
	} else if req.Method == "DELETE" {
	}
}

func setUp() {
	
	http.HandleFunc(
		"/api/v1/auth",
		testHandleAuth,
	)
	
	http.HandleFunc(
		"/api/v1/parcels",
		testHandleUpload,
	)
	
	http.HandleFunc(
		"/api/v1/parcels/",
		testHandleParcel,
	)
	go http.ListenAndServe("localhost:12345", nil)
	Endpoint = "http://localhost:12345"
}