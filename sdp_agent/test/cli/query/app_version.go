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
