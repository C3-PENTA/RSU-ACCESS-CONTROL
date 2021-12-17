package keys

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

const (
	testfile = "test_keyring.json"
)


func TestGenKey(t *testing.T) {
	kr, err := GetKeyRing(testfile)
	assert.NoError(t, err)
	assert.NotNil(t, kr)
	assert.Equal(t, 0, len(kr.keyList))

	key, err := kr.GenerateNewKey("test", "test", []byte("pass"), true)
	assert.NoError(t, err)
	assert.NotNil(t, key)
	assert.Equal(t, 40, len(key.Address))
	assert.Equal(t, 65, len(key.PubKey)) // XXX: really?
	assert.True(t, key.Encrypted)
	key2 := kr.GetKey("test")
	assert.NotNil(t, key2)
	assert.Equal(t, key, key2)

	// check if the actual file was updated
	err = kr.Load()
	assert.NoError(t, err)
	key2 = kr.GetKey("test")
	assert.NotNil(t, key2)
	assert.Equal(t, key, key2)

	// test remove
	err = kr.RemoveKey("test")
	assert.NoError(t, err)
	key2 = kr.GetKey("test")
	assert.Nil(t, key2)

	err = kr.Load()
	assert.NoError(t, err)
	key2 = kr.GetKey("test")
	assert.Nil(t, key2)

	// test genkey without enc
	key, err = kr.GenerateNewKey("test", "test", nil, false)
	assert.NoError(t, err)
	assert.NotNil(t, key)
	assert.Equal(t, 40, len(key.Address))
	assert.Equal(t, 65, len(key.PubKey)) // XXX: really?
	assert.False(t, key.Encrypted)

	_tearDown()
}