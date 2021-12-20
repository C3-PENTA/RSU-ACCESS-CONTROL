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

func udcFunc(cmd *cobra.Command, args []string) error {
	asJson, err := cmd.Flags().GetBool("json")
	if err != nil {
		return err
	}

	res, err := rpc.QueryUDC(args[0])
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
		fmt.Println("no udc")
		return nil
	}
	var udc types.UDC
	err = json.Unmarshal(res, &udc)
	if err != nil {
		return err
	}

	fmt.Println("udc")
	fmt.Println("  - id:", args[0])
	fmt.Println("  - owner:", udc.Owner)
	fmt.Println("  - desc:", udc.Desc)
	fmt.Println("  - operators:", udc.Operators)
	fmt.Println("  - amount:", udc.Total.String())

	return nil
}
