package query

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/amolabs/amo-client-go/lib/rpc"
	"github.com/amolabs/amo-client-go/lib/types"
)

var DelegateCmd = &cobra.Command{
	Use:   "delegate <address>",
	Short: "Delegated stake of an account",
	Args:  cobra.MinimumNArgs(1),
	RunE:  delegateFunc,
}