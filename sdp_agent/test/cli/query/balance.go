package query

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/amolabs/amo-client-go/lib/rpc"
	"github.com/amolabs/amo-client-go/lib/types"
)

var BalanceCmd = &cobra.Command{
	Use:   "balance <address>",
	Short: "Coin balance of an account",
	Args:  cobra.MinimumNArgs(1),
	RunE:  balanceFunc,
}
