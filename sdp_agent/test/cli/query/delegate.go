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

func delegateFunc(cmd *cobra.Command, args []string) error {
	asJson, err := cmd.Flags().GetBool("json")
	if err != nil {
		return err
	}

	res, err := rpc.QueryDelegate(args[0])
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

	if res == nil || len(res) == 0 || string(res) == "null" {
		fmt.Println("no delegate")
	} else {
		var delegate types.Delegate
		err = json.Unmarshal(res, &delegate)
		if err != nil {
			return err
		}
		fmt.Printf("delegatee address: %s\namount: %s\n",
			delegate.Delegatee, delegate.Amount.String())
	}

	return nil
}