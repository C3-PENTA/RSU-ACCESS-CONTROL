package query

import (
	"github.com/spf13/cobra"

	"github.com/amolabs/amo-client-go/cli/util"
)

var Cmd = &cobra.Command{
	Use:     "query",
	Aliases: []string{"q"},
	Short:   "Query AMO blockchain data",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cmd.Help(); err != nil {
			return err
		}

		return nil
	},
}
