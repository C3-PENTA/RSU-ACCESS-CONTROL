package query

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/amolabs/amo-client-go/lib/rpc"
	"github.com/amolabs/amo-client-go/lib/types"
)

var StorageCmd = &cobra.Command{
	Use:   "storage <storage_id>",
	Short: "Storage info",
	Args:  cobra.MinimumNArgs(1),
	RunE:  storageFunc,
}