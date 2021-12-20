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

func storageFunc(cmd *cobra.Command, args []string) error {
	asJson, err := cmd.Flags().GetBool("json")
	if err != nil {
		return err
	}

	res, err := rpc.QueryStorage(args[0])
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
		fmt.Println("no storage")
		return nil
	}

	var storage types.Storage
	err = json.Unmarshal(res, &storage)
	if err != nil {
		return err
	}

	fmt.Printf("owner: %s\n", storage.Owner)
	fmt.Printf("url: %s\n", storage.Url)
	fmt.Printf("registration_fee: %s\n", storage.RegistrationFee.String())
	fmt.Printf("hosting_fee: %s\n", storage.HostingFee.String())
	fmt.Printf("active: %t\n", storage.Active)

	return nil
}
