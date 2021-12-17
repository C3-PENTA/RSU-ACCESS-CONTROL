package keys

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math/big"
	"strings"

	"github.com/tendermint/tendermint/crypto/xsalsa20symmetric"
)

var (
	c = elliptic.P256()
)

type KeyEntry struct {
	Address   string `json:"address"`
	PubKey    []byte `json:"pub_key"`
	PrivKey   []byte `json:"priv_key"`
	Encrypted bool   `json:"encrypted"`
}

func generateECDSAKey(seed string) (privKey *ecdsa.PrivateKey, err error) {
	if len(seed) > 0 {
		b := sha256.Sum256([]byte(seed))
		privKey = new(ecdsa.PrivateKey)
		privKey.D = new(big.Int).SetBytes(b[:])
		X, Y := c.ScalarBaseMult(b[:])
		privKey.PublicKey = ecdsa.PublicKey{
			Curve: c,
			X:     X,
			Y:     Y,
		}
	} else {
		privKey, err = ecdsa.GenerateKey(c, rand.Reader)
	}

	return privKey, err
}

func setECDSAKey(keyBytes []byte) (*ecdsa.PrivateKey, error) {
	if len(keyBytes) != 32 {
		return nil, errors.New("Wrong private key size")
	}
	privKey := new(ecdsa.PrivateKey)
	privKey.D = new(big.Int).SetBytes(keyBytes)
	X, Y := c.ScalarBaseMult(keyBytes)
	privKey.PublicKey = ecdsa.PublicKey{
		Curve: c,
		X:     X,
		Y:     Y,
	}
	return privKey, nil
}