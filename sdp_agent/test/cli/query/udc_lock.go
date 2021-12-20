package query

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/amolabs/amo-client-go/lib/rpc"
	"github.com/amolabs/amo-client-go/lib/types"
)

var UdcLockCmd = &cobra.Command{
	Use:   "lock <udc_id> <address>",
	Short: "Locked UDC of an account",
	Args:  cobra.MinimumNArgs(2),
	RunE:  udcLockFunc,
}