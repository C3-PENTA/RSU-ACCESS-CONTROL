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

func udcLockFunc(cmd *cobra.Command, args []string) error {
	asJson, err := cmd.Flags().GetBool("json")
	if err != nil {
		return err
	}

	res, err := rpc.QueryUDCLock(args[0], args[1])
	if err != nil {
		return err
	}

	if rpc.DryRun {
		return nil
	}

	if asJson {
		fmt.Println(string(res))
		return nil
	}

	var amount types.Currency
	err = json.Unmarshal(res, &amount)
	if err != nil {
		return err
	}
	fmt.Println(amount.String())

	return nil

}
