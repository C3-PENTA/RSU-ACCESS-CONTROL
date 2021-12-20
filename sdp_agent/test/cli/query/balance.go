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

func balanceFunc(cmd *cobra.Command, args []string) error {
	asJson, err := cmd.Flags().GetBool("json")
	if err != nil {
		return err
	}

	udc, err := cmd.Flags().GetUint32("udc")
	if err != nil {
		return err
	}

	// TODO: do some sanity check on client side
	res, err := rpc.QueryBalance(udc, args[0])
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

	var balance types.Currency
	err = json.Unmarshal([]byte(res), &balance)
	if err != nil {
		return err
	}
	fmt.Println(balance.String())

	return nil
}

func init() {
	BalanceCmd.PersistentFlags().Uint32("udc", uint32(0), "specify udc id if necessary")
}

