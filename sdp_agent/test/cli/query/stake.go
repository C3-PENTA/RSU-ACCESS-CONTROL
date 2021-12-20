package query

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/amolabs/amo-client-go/lib/rpc"
	"github.com/amolabs/amo-client-go/lib/types"
)

var StakeCmd = &cobra.Command{
	Use:   "stake <address>",
	Short: "Stake of an account",
	Args:  cobra.MinimumNArgs(1),
	RunE:  stakeFunc,
}