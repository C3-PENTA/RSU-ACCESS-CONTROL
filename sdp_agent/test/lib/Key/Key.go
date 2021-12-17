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

func fillInt(b []byte, l int, i *big.Int) {
	source := i.Bytes()
	offset := l - len(source)
	if offset >= 0 {
		copy(b[offset:], source)
	} else {
		// Inappropriate input data, but we do what we can do.
		copy(b[:l], source)
	}
}

func toKeyEntry(privKey *ecdsa.PrivateKey, pw []byte, encrypt bool) *KeyEntry {
	key := new(KeyEntry)
	b := make([]byte, 32)
	fillInt(b, 32, privKey.D)
	if encrypt {
		encKey := sha256.Sum256(pw)
		key.PrivKey = xsalsa20symmetric.EncryptSymmetric(b, encKey[:])
	} else {
		key.PrivKey = b
	}
	key.Encrypted = encrypt
	// encode to uncompressed form of a public key
	b = make([]byte, 65)
	b[0] = 0x04
	fillInt(b[1:], 32, privKey.PublicKey.X)
	fillInt(b[33:], 32, privKey.PublicKey.Y)
	key.PubKey = b
	// hash it to derive address
	hash := sha256.Sum256(b)
	key.Address = strings.ToUpper(hex.EncodeToString(hash[:20]))

	return key
}

func GenerateKey(seed string, passphrase []byte, encrypt bool) (*KeyEntry, error) {
	privKey, err := generateECDSAKey(seed)
	if err != nil {
		return nil, err
	}

	return toKeyEntry(privKey, passphrase, encrypt), nil
}

func ImportKey(keyBytes []byte, passphrase []byte, encrypt bool) (*KeyEntry, error) {
	privKey, err := setECDSAKey(keyBytes)
	if err != nil {
		return nil, err
	}

	return toKeyEntry(privKey, passphrase, encrypt), nil
}
