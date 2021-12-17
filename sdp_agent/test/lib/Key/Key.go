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