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

func stakeFunc(cmd *cobra.Command, args []string) error {
	asJson, err := cmd.Flags().GetBool("json")
	if err != nil {
		return err
	}

	res, err := rpc.QueryStake(args[0])
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
		fmt.Println("no stake")
	} else {
		var stake types.Stake
		err = json.Unmarshal(res, &stake)
		if err != nil {
			return err
		}

		valb64str := base64.StdEncoding.EncodeToString(stake.Validator)
		valb64, err := hex.DecodeString(valb64str)
		if err != nil {
			return err
		}
		valb64b64str := base64.StdEncoding.EncodeToString(valb64)

		fmt.Printf("amount: %s\n", stake.Amount.String())
		fmt.Printf("validator pubkey (hex)   : 0x%s\n", valb64str)
		fmt.Printf("validator pubkey (base64): %s\n", valb64b64str)
		for i, d := range stake.Delegates {
			fmt.Printf("  delegate %2d: %s from %s\n",
				i+1, d.Amount.String(), d.Delegator)
		}
	}

	return nil
}