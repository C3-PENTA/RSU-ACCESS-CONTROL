package query

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/amolabs/amo-client-go/lib/rpc"
	"github.com/amolabs/amo-client-go/lib/types"
)

var ParcelCmd = &cobra.Command{
	Use:   "parcel <parcelID>",
	Short: "Data parcel detail",
	Args:  cobra.MinimumNArgs(1),
	RunE:  parcelFunc,
}

func parcelFunc(cmd *cobra.Command, args []string) error {
	asJson, err := cmd.Flags().GetBool("json")
	if err != nil {
		return err
	}

	res, err := rpc.QueryParcel(args[0])
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
		fmt.Println("no parcel")
		return nil
	}

	var parcel types.ParcelEx
	err = json.Unmarshal(res, &parcel)
	if err != nil {
		return err
	}

	fmt.Printf("owner: %s\n", parcel.Owner)
	fmt.Printf("custody: %s\n", parcel.Custody)
	fmt.Printf("proxy_account: %s\n", parcel.ProxyAccount)
	fmt.Printf("extra: %s\n", parcel.Extra)
	for i, r := range parcel.Requests {
		fmt.Printf("  requests %2d. agency: %s, recipient: %s, payment: %s, dealer: %s, dealer_fee: %s, extra: %s\n",
			i+1, r.Agency, r.Recipient, r.Payment.String(), r.Dealer, r.DealerFee.String(), r.Extra)
	}
	for i, u := range parcel.Usages {
		fmt.Printf("  usages %2d. recipient: %s, custody: %s, extra: %s\n",
			i+1, u.Recipient, u.Custody, u.Extra)
	}

	return nil
}