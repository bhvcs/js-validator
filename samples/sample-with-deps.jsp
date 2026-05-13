<%@ page language="java" contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Sample JSP With Dependencies</title>
  <script src="./deps/broken-lib.js"></script>
</head>
<body>
  <h1>Dependency Check Sample</h1>

  <script>
    function pageOk() {
      return 42;
    }
  </script>
</body>
</html>
