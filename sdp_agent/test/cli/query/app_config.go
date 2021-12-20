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

func appConfigFunc(cmd *cobra.Command, args []string) error {
	// TODO: do some sanity check on client side
	res, err := rpc.QueryAppConfig()
	if err != nil {
		return err
	}

	if rpc.DryRun {
		return nil
	}

	var appConfig types.AMOAppConfig
	err = json.Unmarshal([]byte(res), &appConfig)
	if err != nil {
		return err
	}

	cfg, err := config.GetConfig(util.DefaultConfigFilePath())
	if err != nil {
		return err
	}

	cfg.SetABCIConfig(appConfig)
	cfg.Save()

	fmt.Println(string(res))

	return nil
}