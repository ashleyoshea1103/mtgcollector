//go:build integration

package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

func TestHealthAgainstARealDatabase(t *testing.T) {
	srv := httptest.NewServer(NewHandler(testdb.New(t)))
	t.Cleanup(srv.Close)

	res, err := http.Get(srv.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	if res.StatusCode != http.StatusOK || string(body) != `{"status":"ok"}`+"\n" {
		t.Errorf("GET /api/health = %d %q, want 200 {\"status\":\"ok\"}", res.StatusCode, body)
	}
}
