package storage

import (
	"net/http"
)

func doInspect(id string) ([]byte, error) {
	client := &http.Client{}
	req, err := http.NewRequest(
		"GET",
		Endpoint+"/api/v1/parcels/"+id+"?key=metadata",
		nil,
	)
	if err != nil {
		return nil, err
	}

	return doHTTP(client, req)
}

// XXX: nothing special, just to match the style with other API functions
func Inspect(parcelID string) ([]byte, error) {
	return doInspect(parcelID)
}
