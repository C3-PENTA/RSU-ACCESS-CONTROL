package query

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/amolabs/amo-client-go/lib/rpc"
	"github.com/amolabs/amo-client-go/lib/types"
)

var UdcCmd = &cobra.Command{
	Use:   "udc <udc_id>",
	Short: "UDC info",
	Args:  cobra.MinimumNArgs(1),
	RunE:  udcFunc,
}