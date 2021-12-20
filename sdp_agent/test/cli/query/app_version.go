package query

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/amolabs/amo-client-go/lib/rpc"
)

var AppVersionCmd = &cobra.Command{
	Use:   "version",
	Short: "App and protocol versions",
	RunE:  appVersionFunc,
}

func appVersionFunc(cmd *cobra.Command, args []string) error {
	asJson, err := cmd.Flags().GetBool("json")
	res, err := rpc.QueryAppVersion()
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

	var appVersion struct {
		AppVersion           string   `json:"app_version,omitempty"`
		AppProtocolVersions  []uint64 `json:"app_protocol_versions,omitempty"`
		StateProtocolVersion uint64   `json:"state_protocol_version,omitempty"`
		AppProtocolVersion   uint64   `json:"app_protocol_version,omitempty"`
	}
	err = json.Unmarshal([]byte(res), &appVersion)
	if err != nil {
		return err
	}

	var vers []string
	for _, v := range appVersion.AppProtocolVersions {
		vers = append(vers, strconv.FormatUint(v, 10))
	}
	versString := strings.Join(vers, ", ")

	fmt.Println("App version                    =",
		appVersion.AppVersion)
	fmt.Println("Supported protocol versions    =", "[", versString, "]")
	fmt.Println("Current state protocol version =",
		appVersion.StateProtocolVersion)
	fmt.Println("Current app protocol version   =",
		appVersion.AppProtocolVersion)

	return nil
}
